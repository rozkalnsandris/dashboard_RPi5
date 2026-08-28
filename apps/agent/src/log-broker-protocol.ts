import type { LogRange, LogSourceId } from "@dashboard-rpi5/contracts/logs";

export const LOG_BROKER_SOCKET_ENV = "DASHBOARD_LOG_BROKER_SOCKET" as const;
export const DEFAULT_LOG_BROKER_SOCKET_PATH = "/run/dashboard-rpi5-log-broker/broker.sock";
export const LOG_BROKER_HEALTH_PATH = "/v1/health" as const;
export const LOG_BROKER_MAX_REQUEST_URL_BYTES = 192;
export const LOG_BROKER_MAX_CONCURRENT_REQUESTS = 4;
export const LOG_BROKER_MAX_RESPONSE_BYTES = 1024 * 1024;
export const LOG_BROKER_REQUEST_TIMEOUT_MS = 2_500;

export const LOG_BROKER_SOURCE_IDS = [
  "systemd:docker",
  "systemd:ssh",
  "systemd:cron",
  "systemd:dashboard-rpi5-agent",
  "systemd:rpi5-update",
  "systemd:cloudflared",
  "systemd:rpi5-monitor",
  "systemd:rpi5-post-reboot",
  "systemd:rpi5-tmp-headroom",
  "systemd:rpi5-dashboard-evidence",
  "systemd:hermes-tech-web",
  "journal:rpi5-deploy",
  "file:rpi5-backup",
] as const satisfies readonly LogSourceId[];

export const LOG_BROKER_RANGES = ["15m", "1h", "6h", "24h"] as const satisfies readonly LogRange[];

export type LogBrokerSourceId = (typeof LOG_BROKER_SOURCE_IDS)[number];
export type LogBrokerRange = (typeof LOG_BROKER_RANGES)[number];

const sourceIds = new Set<string>(LOG_BROKER_SOURCE_IDS);
const ranges = new Set<string>(LOG_BROKER_RANGES);

export function isLogBrokerSourceId(value: string): value is LogBrokerSourceId {
  return sourceIds.has(value);
}

function isLogBrokerRange(value: string): value is LogBrokerRange {
  return ranges.has(value);
}

export type LogBrokerRoute =
  | { kind: "health" }
  | { kind: "logs"; sourceId: LogBrokerSourceId; range: LogBrokerRange };

export function logBrokerLogsPath(sourceId: LogBrokerSourceId, range: LogBrokerRange): string {
  if (!isLogBrokerSourceId(sourceId) || !isLogBrokerRange(range)) {
    throw new Error("invalid log broker capability");
  }
  return `/v1/logs/${sourceId}/${range}`;
}

export function parseLogBrokerRoute(rawUrl: string): LogBrokerRoute | null {
  if (Buffer.byteLength(rawUrl, "utf8") > LOG_BROKER_MAX_REQUEST_URL_BYTES) return null;
  if (rawUrl === LOG_BROKER_HEALTH_PATH) return { kind: "health" };

  const match = /^\/v1\/logs\/([a-z0-9:-]+)\/(15m|1h|6h|24h)$/.exec(rawUrl);
  if (match === null) return null;
  const sourceId = match[1] ?? "";
  const range = match[2] ?? "";
  if (!isLogBrokerSourceId(sourceId) || !isLogBrokerRange(range)) return null;
  return { kind: "logs", sourceId, range };
}
