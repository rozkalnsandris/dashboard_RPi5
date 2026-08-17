import type {
  DockerContainersSnapshot,
  HostSummary,
} from "@dashboard-rpi5/contracts";
import {
  parseDockerContainersSnapshot,
  parseHostSummary,
} from "@dashboard-rpi5/contracts/current-state";

async function readJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error("Current-state evidence unavailable");
  return response.json();
}

export async function fetchCurrentHost(signal?: AbortSignal): Promise<HostSummary> {
  return parseHostSummary(await readJson("/api/current/host", signal));
}

export async function fetchCurrentDocker(signal?: AbortSignal): Promise<DockerContainersSnapshot> {
  return parseDockerContainersSnapshot(await readJson("/api/current/docker", signal));
}
