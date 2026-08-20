import { isDockerContainerId } from "./docker-api.js";

export const DOCKER_BROKER_SOCKET_ENV = "DASHBOARD_DOCKER_BROKER_SOCKET" as const;
export const DEFAULT_DOCKER_BROKER_SOCKET_PATH = "/run/dashboard-rpi5-docker-broker/broker.sock";
export const DOCKER_BROKER_HEALTH_PATH = "/v1/health" as const;
export const DOCKER_BROKER_PING_PATH = "/v1/docker/ping" as const;
export const DOCKER_BROKER_VERSION_PATH = "/v1/docker/version" as const;
export const DOCKER_BROKER_CONTAINERS_PATH = "/v1/docker/containers" as const;
export const DOCKER_BROKER_EVENTS_PATH = "/v1/docker/events/recent" as const;
export const DOCKER_BROKER_EVENTS_MAX_WINDOW_SECONDS = 60 * 60;
export const DOCKER_BROKER_EVENTS_MAX_ITEMS = 512;
export const DOCKER_BROKER_MAX_REQUEST_URL_BYTES = 256;
export const DOCKER_BROKER_MAX_CONCURRENT_REQUESTS = 8;
export const DOCKER_BROKER_LOG_MAX_RESPONSE_BYTES = 512 * 1024;
export const DOCKER_BROKER_LOG_TAIL = 400;

export const DOCKER_BROKER_LOG_SOURCES = ["homeassistant", "prometheus"] as const;
export const DOCKER_BROKER_LOG_RANGES = ["15m", "1h", "6h", "24h"] as const;

export type DockerBrokerLogSource = (typeof DOCKER_BROKER_LOG_SOURCES)[number];
export type DockerBrokerLogRange = (typeof DOCKER_BROKER_LOG_RANGES)[number];

export const DOCKER_BROKER_LOG_LOOKBACK_SECONDS: Readonly<Record<DockerBrokerLogRange, number>> = {
  "15m": 15 * 60,
  "1h": 60 * 60,
  "6h": 6 * 60 * 60,
  "24h": 24 * 60 * 60,
};

function isDockerBrokerLogSource(value: string): value is DockerBrokerLogSource {
  return (DOCKER_BROKER_LOG_SOURCES as readonly string[]).includes(value);
}

function isDockerBrokerLogRange(value: string): value is DockerBrokerLogRange {
  return (DOCKER_BROKER_LOG_RANGES as readonly string[]).includes(value);
}

function validEventsWindow(since: number, until: number): boolean {
  return (
    Number.isSafeInteger(since) &&
    Number.isSafeInteger(until) &&
    since >= 0 &&
    until >= since &&
    until - since <= DOCKER_BROKER_EVENTS_MAX_WINDOW_SECONDS
  );
}

export type DockerBrokerRoute =
  | { kind: "health" }
  | { kind: "ping" }
  | { kind: "version" }
  | { kind: "containers" }
  | { kind: "inspect"; id: string }
  | { kind: "stats"; id: string }
  | { kind: "logs"; source: DockerBrokerLogSource; range: DockerBrokerLogRange }
  | { kind: "events"; since: number; until: number };

export function dockerBrokerInspectPath(id: string): string {
  if (!isDockerContainerId(id)) throw new Error("invalid Docker container ID");
  return `/v1/docker/containers/${id}/inspect`;
}

export function dockerBrokerStatsPath(id: string): string {
  if (!isDockerContainerId(id)) throw new Error("invalid Docker container ID");
  return `/v1/docker/containers/${id}/stats`;
}

export function dockerBrokerLogsPath(
  source: DockerBrokerLogSource,
  range: DockerBrokerLogRange,
): string {
  if (!isDockerBrokerLogSource(source) || !isDockerBrokerLogRange(range)) {
    throw new Error("invalid Docker log capability");
  }
  return `/v1/docker/logs/${source}/${range}`;
}

export function dockerBrokerEventsPath(since: number, until: number): string {
  if (!validEventsWindow(since, until)) throw new Error("invalid Docker events window");
  return `${DOCKER_BROKER_EVENTS_PATH}?since=${since}&until=${until}`;
}

export function parseDockerBrokerRoute(rawUrl: string): DockerBrokerRoute | null {
  if (Buffer.byteLength(rawUrl, "utf8") > DOCKER_BROKER_MAX_REQUEST_URL_BYTES) return null;

  switch (rawUrl) {
    case DOCKER_BROKER_HEALTH_PATH:
      return { kind: "health" };
    case DOCKER_BROKER_PING_PATH:
      return { kind: "ping" };
    case DOCKER_BROKER_VERSION_PATH:
      return { kind: "version" };
    case DOCKER_BROKER_CONTAINERS_PATH:
      return { kind: "containers" };
  }

  const inspect = /^\/v1\/docker\/containers\/([0-9a-f]{64})\/inspect$/.exec(rawUrl);
  if (inspect !== null && isDockerContainerId(inspect[1] ?? "")) {
    return { kind: "inspect", id: inspect[1] ?? "" };
  }

  const stats = /^\/v1\/docker\/containers\/([0-9a-f]{64})\/stats$/.exec(rawUrl);
  if (stats !== null && isDockerContainerId(stats[1] ?? "")) {
    return { kind: "stats", id: stats[1] ?? "" };
  }

  const logs = /^\/v1\/docker\/logs\/([a-z0-9_-]+)\/(15m|1h|6h|24h)$/.exec(rawUrl);
  if (
    logs !== null &&
    isDockerBrokerLogSource(logs[1] ?? "") &&
    isDockerBrokerLogRange(logs[2] ?? "")
  ) {
    return {
      kind: "logs",
      source: logs[1] as DockerBrokerLogSource,
      range: logs[2] as DockerBrokerLogRange,
    };
  }

  const events = /^\/v1\/docker\/events\/recent\?since=(0|[1-9]\d*)&until=(0|[1-9]\d*)$/.exec(rawUrl);
  if (events !== null) {
    const since = Number(events[1]);
    const until = Number(events[2]);
    if (validEventsWindow(since, until)) return { kind: "events", since, until };
  }

  return null;
}
