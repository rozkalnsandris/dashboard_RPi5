import type {
  DockerHistoryIdentity,
  DockerHistoryMetric,
  DockerTopConsumer,
  DockerTopConsumersSnapshot,
  DockerTopRanking,
  HistoryPoint,
  HistoryRange,
} from "@dashboard-rpi5/contracts/history";

import { formatBytes } from "./current-state-ui";

export const DOCKER_HISTORY_METRICS = [
  "CPU_PERCENT",
  "MEMORY_WORKING_SET_BYTES",
] as const satisfies readonly DockerHistoryMetric[];
export const DOCKER_HISTORY_RANGES: readonly HistoryRange[] = ["1h", "24h", "7d"];

const HISTORY_MAX_POINTS: Record<HistoryRange, number> = {
  "1h": 121,
  "24h": 289,
  "7d": 337,
};
const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
const MAX_CPU_PERCENT = 100_000;
const MAX_MEMORY_BYTES = 1e18;
const COMPOSE_COMPONENT_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,127}$/;
const COMPOSE_CONTAINER_NUMBER_PATTERN = /^[1-9][0-9]{0,9}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHistoryRange(value: unknown): value is HistoryRange {
  return DOCKER_HISTORY_RANGES.includes(value as HistoryRange);
}

function isDockerHistoryMetric(value: unknown): value is DockerHistoryMetric {
  return (
    typeof value === "string" &&
    (DOCKER_HISTORY_METRICS as readonly string[]).includes(value)
  );
}

function metricValueIsValid(metric: DockerHistoryMetric, value: number): boolean {
  if (!Number.isFinite(value) || value < 0) return false;
  return metric === "CPU_PERCENT" ? value <= MAX_CPU_PERCENT : value <= MAX_MEMORY_BYTES;
}

function parseIdentity(value: unknown): DockerHistoryIdentity | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort();
  const expected = ["composeContainerNumber", "composeProject", "composeService"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return null;
  }
  if (
    typeof value.composeProject !== "string" ||
    typeof value.composeService !== "string" ||
    typeof value.composeContainerNumber !== "string" ||
    !COMPOSE_COMPONENT_PATTERN.test(value.composeProject) ||
    !COMPOSE_COMPONENT_PATTERN.test(value.composeService) ||
    !COMPOSE_CONTAINER_NUMBER_PATTERN.test(value.composeContainerNumber)
  ) {
    return null;
  }
  return {
    composeProject: value.composeProject,
    composeService: value.composeService,
    composeContainerNumber: value.composeContainerNumber,
  };
}

function identityKey(identity: DockerHistoryIdentity): string {
  return `${identity.composeProject}\0${identity.composeService}\0${identity.composeContainerNumber}`;
}

function parsePoint(
  value: unknown,
  metric: DockerHistoryMetric,
  windowStart: number,
  windowEnd: number,
): HistoryPoint | null {
  if (!isRecord(value) || typeof value.timestamp !== "string" || typeof value.value !== "number") {
    return null;
  }
  const timestamp = Date.parse(value.timestamp);
  if (
    !Number.isFinite(timestamp) ||
    timestamp < windowStart ||
    timestamp > windowEnd ||
    !metricValueIsValid(metric, value.value)
  ) {
    return null;
  }
  return { timestamp: value.timestamp, value: value.value };
}

function parseConsumer(
  value: unknown,
  metric: DockerHistoryMetric,
  maxPoints: number,
  windowStart: number,
  windowEnd: number,
): DockerTopConsumer | null {
  if (!isRecord(value)) return null;
  const identity = parseIdentity(value.identity);
  if (
    identity === null ||
    typeof value.latest !== "number" ||
    typeof value.average !== "number" ||
    typeof value.maximum !== "number" ||
    !metricValueIsValid(metric, value.latest) ||
    !metricValueIsValid(metric, value.average) ||
    !metricValueIsValid(metric, value.maximum) ||
    !Array.isArray(value.points) ||
    value.points.length === 0 ||
    value.points.length > maxPoints
  ) {
    return null;
  }

  const points: HistoryPoint[] = [];
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  let total = 0;
  let maximum = 0;
  for (const point of value.points) {
    const parsed = parsePoint(point, metric, windowStart, windowEnd);
    if (parsed === null) return null;
    const timestamp = Date.parse(parsed.timestamp);
    if (timestamp <= previousTimestamp) return null;
    previousTimestamp = timestamp;
    total += parsed.value;
    maximum = Math.max(maximum, parsed.value);
    points.push(parsed);
  }

  const latest = points.at(-1)?.value;
  if (latest === undefined) return null;
  const average = total / points.length;
  const tolerance = Math.max(1e-9, Math.abs(average) * 1e-9);
  if (
    value.latest !== latest ||
    Math.abs(value.average - average) > tolerance ||
    value.maximum !== maximum
  ) {
    return null;
  }
  return { identity, latest: value.latest, average: value.average, maximum: value.maximum, points };
}

function parseRanking(
  value: unknown,
  maxPoints: number,
  windowStart: number,
  windowEnd: number,
): DockerTopRanking | null {
  if (!isRecord(value) || !isDockerHistoryMetric(value.metric)) return null;
  if (value.state !== "AVAILABLE" && value.state !== "UNAVAILABLE") return null;
  if (!Array.isArray(value.consumers) || value.consumers.length > 5) return null;
  if (value.state === "UNAVAILABLE") {
    return value.consumers.length === 0
      ? { metric: value.metric, state: "UNAVAILABLE", consumers: [] }
      : null;
  }
  if (value.consumers.length === 0) return null;

  const consumers: DockerTopConsumer[] = [];
  const identities = new Set<string>();
  let previousAverage = Number.POSITIVE_INFINITY;
  for (const consumer of value.consumers) {
    const parsed = parseConsumer(consumer, value.metric, maxPoints, windowStart, windowEnd);
    if (parsed === null || parsed.average > previousAverage) return null;
    previousAverage = parsed.average;
    const key = identityKey(parsed.identity);
    if (identities.has(key)) return null;
    identities.add(key);
    consumers.push(parsed);
  }
  return { metric: value.metric, state: "AVAILABLE", consumers };
}

export function parseDockerTopConsumersSnapshot(value: unknown): DockerTopConsumersSnapshot {
  if (!isRecord(value)) throw new Error("Invalid Docker history response");
  if (
    typeof value.observedAt !== "string" ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    !isHistoryRange(value.range) ||
    typeof value.windowStart !== "string" ||
    !Number.isFinite(Date.parse(value.windowStart)) ||
    typeof value.windowEnd !== "string" ||
    !Number.isFinite(Date.parse(value.windowEnd)) ||
    !Array.isArray(value.rankings) ||
    value.rankings.length !== DOCKER_HISTORY_METRICS.length
  ) {
    throw new Error("Invalid Docker history response");
  }

  const windowStart = Date.parse(value.windowStart);
  const windowEnd = Date.parse(value.windowEnd);
  const observedAt = Date.parse(value.observedAt);
  if (windowStart > windowEnd || observedAt < windowEnd) {
    throw new Error("Invalid Docker history response");
  }

  const maxPoints = HISTORY_MAX_POINTS[value.range];
  const rankings = value.rankings.map((ranking) =>
    parseRanking(ranking, maxPoints, windowStart, windowEnd),
  );
  if (rankings.some((ranking) => ranking === null)) {
    throw new Error("Invalid Docker history response");
  }
  const typedRankings = rankings as DockerTopRanking[];
  const metrics = new Set(typedRankings.map((ranking) => ranking.metric));
  if (
    metrics.size !== DOCKER_HISTORY_METRICS.length ||
    DOCKER_HISTORY_METRICS.some((metric) => !metrics.has(metric))
  ) {
    throw new Error("Invalid Docker history response");
  }

  return {
    observedAt: value.observedAt,
    range: value.range,
    windowStart: value.windowStart,
    windowEnd: value.windowEnd,
    rankings: typedRankings,
  };
}

export async function fetchDockerTopConsumers(
  range: HistoryRange,
  signal?: AbortSignal,
): Promise<DockerTopConsumersSnapshot> {
  if (!isHistoryRange(range)) throw new Error("Unsupported history range");
  const response = await fetch(`/api/history/docker/top?range=${range}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error("Docker history source unavailable");
  const raw = await response.text();
  if (raw.length > MAX_RESPONSE_CHARS) throw new Error("Docker history source unavailable");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error("Docker history source unavailable");
  }
  const snapshot = parseDockerTopConsumersSnapshot(parsedJson);
  if (snapshot.range !== range) throw new Error("Docker history source unavailable");
  return snapshot;
}

export function dockerIdentityLabel(identity: DockerHistoryIdentity): string {
  return `${identity.composeProject}/${identity.composeService} #${identity.composeContainerNumber}`;
}

export function formatDockerHistoryValue(metric: DockerHistoryMetric, value: number): string {
  return metric === "CPU_PERCENT" ? `${value.toFixed(1)}%` : formatBytes(value);
}

export function buildDockerHistorySparklinePoints(
  consumer: DockerTopConsumer,
  width = 160,
  height = 48,
): string {
  if (consumer.points.length === 0) return "";
  const upper = Math.max(1, ...consumer.points.map((point) => point.value));
  const denominator = Math.max(consumer.points.length - 1, 1);
  return consumer.points
    .map((point, index) => {
      const x = (index / denominator) * width;
      const y = height - Math.max(0, Math.min(1, point.value / upper)) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
