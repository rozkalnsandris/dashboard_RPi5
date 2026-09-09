import type {
  HistoryPoint,
  HostHistoryRegistryMetric,
} from "@dashboard-rpi5/contracts/history";

import { PrometheusSourceUnavailableError } from "./prometheus-types.js";

export type NormalizedHostHistorySeries<M extends HostHistoryRegistryMetric> =
  | { metric: M; state: "AVAILABLE"; points: HistoryPoint[] }
  | { metric: M; state: "UNAVAILABLE"; points: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new PrometheusSourceUnavailableError();
  return value;
}

function isNonFinitePrometheusValue(value: string): boolean {
  return value === "NaN" || value === "+Inf" || value === "-Inf" || value === "Inf";
}

function validateMetricValue(metric: HostHistoryRegistryMetric, value: number): boolean {
  if (!Number.isFinite(value)) return false;

  switch (metric) {
    case "CPU_PERCENT":
    case "CPU_USER_PERCENT":
    case "CPU_SYSTEM_PERCENT":
    case "CPU_IOWAIT_PERCENT":
    case "MEMORY_PERCENT":
    case "SWAP_PERCENT":
    case "ROOT_FS_PERCENT":
    case "FAN_PWM_PERCENT":
      return value >= 0 && value <= 100;
    case "SOC_TEMP_CELSIUS":
    case "NVME_TEMP_CELSIUS":
      return value >= -273.15 && value <= 250;
    case "LOAD1":
    case "FAN_RPM":
    case "NETWORK_RX_BYTES_PER_SECOND":
    case "NETWORK_TX_BYTES_PER_SECOND":
    case "DISK_READ_BYTES_PER_SECOND":
    case "DISK_WRITE_BYTES_PER_SECOND":
    case "UPTIME_SECONDS":
      return value >= 0;
  }
}

export function normalizePrometheusMatrix<M extends HostHistoryRegistryMetric>(
  raw: unknown,
  metric: M,
  startEpochSeconds: number,
  endEpochSeconds: number,
  maxPoints: number,
): NormalizedHostHistorySeries<M> {
  const envelope = requireRecord(raw);
  if (envelope.status !== "success") throw new PrometheusSourceUnavailableError();

  const data = requireRecord(envelope.data);
  if (data.resultType !== "matrix" || !Array.isArray(data.result) || data.result.length > 1) {
    throw new PrometheusSourceUnavailableError();
  }

  if (data.result.length === 0) {
    return { metric, state: "UNAVAILABLE", points: [] };
  }

  const result = requireRecord(data.result[0]);
  if (!Array.isArray(result.values) || result.values.length > maxPoints) {
    throw new PrometheusSourceUnavailableError();
  }

  const points: HistoryPoint[] = [];
  let previousTimestamp = -1;

  for (const rawPoint of result.values) {
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
    if (!validateMetricValue(metric, value)) throw new PrometheusSourceUnavailableError();

    const date = new Date(rawTimestamp * 1_000);
    if (!Number.isFinite(date.getTime())) throw new PrometheusSourceUnavailableError();
    points.push({ timestamp: date.toISOString(), value });
  }

  if (points.length === 0) {
    return { metric, state: "UNAVAILABLE", points: [] };
  }

  return { metric, state: "AVAILABLE", points };
}
