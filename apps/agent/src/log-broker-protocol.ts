import type { LogRange, LogSourceId } from "@dashboard-rpi5/contracts/logs";

import { isPrivilegedLogSourceId, type PrivilegedLogSourceId } from "./privileged-log-sources.js";

export const LOG_BROKER_SOCKET_ENV = "DASHBOARD_RPI5_LOG_BROKER_SOCKET" as const;
export const DEFAULT_LOG_BROKER_SOCKET_PATH = "/run/dashboard-rpi5-log-broker/broker.sock";
export const LOG_BROKER_HEALTH_PATH = "/v1/health" as const;
export const LOG_BROKER_MAX_REQUEST_URL_BYTES = 256;
export const LOG_BROKER_MAX_RESPONSE_BYTES = 768 * 1024;
export const LOG_BROKER_MAX_CONCURRENT_REQUESTS = 4;
export const LOG_BROKER_OPERATION_TIMEOUT_MS = 2_000;
export const LOG_BROKER_RANGES = ["15m", "1h", "6h", "24h"] as const satisfies readonly LogRange[];

export type LogBrokerRoute =
  | { kind: "health" }
  | { kind: "logs"; sourceId: PrivilegedLogSourceId; range: LogRange };

function isLogRange(value: string): value is LogRange {
  return (LOG_BROKER_RANGES as readonly string[]).includes(value);
}

export function logBrokerLogsPath(sourceId: LogSourceId, range: LogRange): string {
  if (!isPrivilegedLogSourceId(sourceId) || !isLogRange(range)) throw new Error("invalid privileged log capability");
  return `/v1/logs/${encodeURIComponent(sourceId)}/${range}`;
}

export function parseLogBrokerRoute(rawUrl: string): LogBrokerRoute | null {
  if (Buffer.byteLength(rawUrl, "utf8") > LOG_BROKER_MAX_REQUEST_URL_BYTES) return null;
  if (rawUrl === LOG_BROKER_HEALTH_PATH) return { kind: "health" };
  const match = /^\/v1\/logs\/([^/?#]+)\/(15m|1h|6h|24h)$/.exec(rawUrl);
  if (match === null) return null;
  let sourceId: string;
  try {
    sourceId = decodeURIComponent(match[1] ?? "");
  } catch {
    return null;
  }
  const range = match[2] ?? "";
  if (!isPrivilegedLogSourceId(sourceId as LogSourceId) || !isLogRange(range)) return null;
  return { kind: "logs", sourceId: sourceId as PrivilegedLogSourceId, range };
}
