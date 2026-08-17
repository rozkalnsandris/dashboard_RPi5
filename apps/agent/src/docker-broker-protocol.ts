import { isDockerContainerId } from "./docker-api.js";

export const DOCKER_BROKER_SOCKET_ENV = "DASHBOARD_DOCKER_BROKER_SOCKET" as const;
export const DEFAULT_DOCKER_BROKER_SOCKET_PATH = "/run/dashboard-rpi5-docker-broker/broker.sock";
export const DOCKER_BROKER_HEALTH_PATH = "/v1/health" as const;
export const DOCKER_BROKER_PING_PATH = "/v1/docker/ping" as const;
export const DOCKER_BROKER_VERSION_PATH = "/v1/docker/version" as const;
export const DOCKER_BROKER_CONTAINERS_PATH = "/v1/docker/containers" as const;
export const DOCKER_BROKER_MAX_REQUEST_URL_BYTES = 256;
export const DOCKER_BROKER_MAX_CONCURRENT_REQUESTS = 8;

export type DockerBrokerRoute =
  | { kind: "health" }
  | { kind: "ping" }
  | { kind: "version" }
  | { kind: "containers" }
  | { kind: "inspect"; id: string }
  | { kind: "stats"; id: string };

export function dockerBrokerInspectPath(id: string): string {
  if (!isDockerContainerId(id)) throw new Error("invalid Docker container ID");
  return `/v1/docker/containers/${id}/inspect`;
}

export function dockerBrokerStatsPath(id: string): string {
  if (!isDockerContainerId(id)) throw new Error("invalid Docker container ID");
  return `/v1/docker/containers/${id}/stats`;
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

  return null;
}
