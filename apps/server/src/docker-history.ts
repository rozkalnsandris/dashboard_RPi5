import type {
  DockerHistoryIdentity,
  DockerHistoryMetric,
  DockerTopConsumer,
  DockerTopConsumersSnapshot,
  DockerTopRanking,
  HistoryPoint,
  HistoryRange,
} from "@dashboard-rpi5/contracts/history";

import { HISTORY_RANGE_POLICY } from "./history-policy.js";
import { createPrometheusHttpTransport } from "./prometheus-client.js";
import { buildDockerTopConsumersPromqlRegistry } from "./prometheus-query-registry.js";
import {
  PROMETHEUS_DEFAULT_BASE_URL,
  PrometheusSourceUnavailableError,
  type PrometheusTransport,
} from "./prometheus-types.js";

export const DOCKER_HISTORY_METRICS = Object.freeze([
  "CPU_PERCENT",
  "MEMORY_WORKING_SET_BYTES",
] as const satisfies readonly DockerHistoryMetric[]);
export const DOCKER_HISTORY_MAX_SOURCE_SERIES = 64;
export const DOCKER_HISTORY_QUERY_SERIES_LIMIT = DOCKER_HISTORY_MAX_SOURCE_SERIES + 1;
export const DOCKER_TOP_CONSUMER_LIMIT = 5;

const COMPOSE_COMPONENT_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,127}$/;
const COMPOSE_CONTAINER_NUMBER_PATTERN = /^[1-9][0-9]{0,9}$/;
const MAX_CPU_PERCENT = 100_000;
const MAX_MEMORY_BYTES = 1e18;

interface DockerHistoryReaderOptions {
  prometheusBaseUrl?: string;
  transport?: PrometheusTransport;
  now?: () => Date;
}

export type DockerHistoryReader = (
  range: HistoryRange,
  signal?: AbortSignal,
) => Promise<DockerTopConsumersSnapshot>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new PrometheusSourceUnavailableError();
  return value;
}

function validIdentityComponent(value: string): boolean {
  return Buffer.byteLength(value, "utf8") <= 128 && COMPOSE_COMPONENT_PATTERN.test(value);
}

function parseIdentity(rawMetric: unknown): DockerHistoryIdentity {
  const metric = requireRecord(rawMetric);
  const composeProject = metric.compose_project;
  const composeService = metric.compose_service;
  const composeContainerNumber = metric.compose_container_number;
  if (
    typeof composeProject !== "string" ||
    typeof composeService !== "string" ||
    typeof composeContainerNumber !== "string" ||
    !validIdentityComponent(composeProject) ||
    !validIdentityComponent(composeService) ||
    Buffer.byteLength(composeContainerNumber, "utf8") > 10 ||
    !COMPOSE_CONTAINER_NUMBER_PATTERN.test(composeContainerNumber)
  ) {
    throw new PrometheusSourceUnavailableError();
  }
  return { composeProject, composeService, composeContainerNumber };
}

function identityKey(identity: DockerHistoryIdentity): string {
  return `${identity.composeProject}\0${identity.composeService}\0${identity.composeContainerNumber}`;
}

function metricValueIsValid(metric: DockerHistoryMetric, value: number): boolean {
  if (!Number.isFinite(value) || value < 0) return false;
  return metric === "CPU_PERCENT" ? value <= MAX_CPU_PERCENT : value <= MAX_MEMORY_BYTES;
}

function isNonFinitePrometheusValue(value: string): boolean {
  return value === "NaN" || value === "+Inf" || value === "-Inf" || value === "Inf";
}

function parsePoints(
  rawValues: unknown,
  metric: DockerHistoryMetric,
  startEpochSeconds: number,
  endEpochSeconds: number,
  maxPoints: number,
): HistoryPoint[] {
  if (!Array.isArray(rawValues) || rawValues.length > maxPoints) {
    throw new PrometheusSourceUnavailableError();
  }
  const points: HistoryPoint[] = [];
  let previousTimestamp = -1;
  for (const rawPoint of rawValues) {
    if (!Array.isArray(rawPoint) || rawPoint.length !== 2) {
      throw new PrometheusSourceUnavailableError();
    }
    const [rawTimestamp, rawValue] = rawPoint;
    if (
      typeof rawTimestamp !== "number" ||
      !Number.isFinite(rawTimestamp) ||
      rawTimestamp < startEpochSeconds ||
      rawTimestamp > endEpochSeconds ||
      rawTimestamp <= previousTimestamp ||
      typeof rawValue !== "string"
    ) {
      throw new PrometheusSourceUnavailableError();
    }
    previousTimestamp = rawTimestamp;
    if (isNonFinitePrometheusValue(rawValue)) continue;
    const value = Number(rawValue);
    if (!metricValueIsValid(metric, value)) throw new PrometheusSourceUnavailableError();
    points.push({ timestamp: new Date(rawTimestamp * 1_000).toISOString(), value });
  }
  return points;
}

function normalizeRanking(
  raw: unknown,
  metric: DockerHistoryMetric,
  startEpochSeconds: number,
  endEpochSeconds: number,
  maxPoints: number,
): DockerTopRanking {
  const envelope = requireRecord(raw);
  if (envelope.status !== "success") throw new PrometheusSourceUnavailableError();
  const data = requireRecord(envelope.data);
  if (data.resultType !== "matrix" || !Array.isArray(data.result)) {
    throw new PrometheusSourceUnavailableError();
  }
  if (data.result.length > DOCKER_HISTORY_MAX_SOURCE_SERIES) {
    throw new PrometheusSourceUnavailableError();
  }

  const identities = new Set<string>();
  const consumers: DockerTopConsumer[] = [];
  for (const rawSeries of data.result) {
    const series = requireRecord(rawSeries);
    const identity = parseIdentity(series.metric);
    const key = identityKey(identity);
    if (identities.has(key)) throw new PrometheusSourceUnavailableError();
    identities.add(key);

    const points = parsePoints(
      series.values,
      metric,
      startEpochSeconds,
      endEpochSeconds,
      maxPoints,
    );
    if (points.length === 0) continue;

    let total = 0;
    let maximum = 0;
    for (const point of points) {
      total += point.value;
      maximum = Math.max(maximum, point.value);
    }
    const latest = points.at(-1)?.value;
    if (latest === undefined) throw new PrometheusSourceUnavailableError();
    const average = total / points.length;
    if (!metricValueIsValid(metric, average) || !metricValueIsValid(metric, maximum)) {
      throw new PrometheusSourceUnavailableError();
    }
    consumers.push({ identity, latest, average, maximum, points });
  }

  consumers.sort((left, right) => {
    if (right.average !== left.average) return right.average - left.average;
    return identityKey(left.identity).localeCompare(identityKey(right.identity));
  });
  const top = consumers.slice(0, DOCKER_TOP_CONSUMER_LIMIT);
  return top.length === 0
    ? { metric, state: "UNAVAILABLE", consumers: [] }
    : { metric, state: "AVAILABLE", consumers: top };
}

export function createDockerHistoryReader(
  options: DockerHistoryReaderOptions = {},
): DockerHistoryReader {
  const registry = buildDockerTopConsumersPromqlRegistry();
  const transport =
    options.transport ??
    createPrometheusHttpTransport(options.prometheusBaseUrl ?? PROMETHEUS_DEFAULT_BASE_URL);
  const now = options.now ?? (() => new Date());

  return async (range, signal) => {
    try {
      signal?.throwIfAborted();
      const policy = HISTORY_RANGE_POLICY[range];
      if (policy === undefined) throw new PrometheusSourceUnavailableError();
      const observedAt = now();
      if (!Number.isFinite(observedAt.getTime())) throw new PrometheusSourceUnavailableError();
      const endEpochSeconds = Math.floor(observedAt.getTime() / 1_000);
      const startEpochSeconds = endEpochSeconds - policy.durationSeconds;

      const rankings = await Promise.all(
        DOCKER_HISTORY_METRICS.map(async (metric) => {
          const raw = await transport.read(
            {
              query: registry[metric],
              startEpochSeconds,
              endEpochSeconds,
              stepSeconds: policy.stepSeconds,
              maxSeries: DOCKER_HISTORY_QUERY_SERIES_LIMIT,
            },
            signal,
          );
          return normalizeRanking(
            raw,
            metric,
            startEpochSeconds,
            endEpochSeconds,
            policy.maxPoints,
          );
        }),
      );

      signal?.throwIfAborted();
      return {
        observedAt: observedAt.toISOString(),
        range,
        windowStart: new Date(startEpochSeconds * 1_000).toISOString(),
        windowEnd: new Date(endEpochSeconds * 1_000).toISOString(),
        rankings,
      };
    } catch (error: unknown) {
      if (error instanceof PrometheusSourceUnavailableError) throw error;
      throw new PrometheusSourceUnavailableError();
    }
  };
}
