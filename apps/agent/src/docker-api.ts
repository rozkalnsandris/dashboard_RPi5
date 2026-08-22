export const DOCKER_API_VERSION = "1.40" as const;
export const DOCKER_API_PREFIX = `/v${DOCKER_API_VERSION}` as const;
export const DOCKER_ENGINE_SOCKET_ENV = "DASHBOARD_DOCKER_SOCKET_PATH" as const;
export const DEFAULT_DOCKER_ENGINE_SOCKET_PATH = "/var/run/docker.sock";
// Docker's non-streaming stats path may wait for two collection cycles so
// precpu_stats is available for CPU percentage calculation. #196 live evidence
// measured the direct read just beyond the old 1500 ms cutoff.
export const DOCKER_REQUEST_TIMEOUT_MS = 3_000;
export const DOCKER_MAX_RESPONSE_BYTES = 1_048_576;
export const DOCKER_CONTAINER_CONCURRENCY = 8;

const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/;

export function isDockerContainerId(value: string): boolean {
  return CONTAINER_ID_PATTERN.test(value);
}
