import { describe, expect, it } from "vitest";

import type { DockerBrokerTransport } from "./docker-broker-client.js";
import { DOCKER_CONTAINER_CONCURRENCY, readDockerContainers } from "./docker-read.js";
import { runWithTimeout } from "./operation-registry.js";
import { DOCKER_CONTAINERS_OPERATION_TIMEOUT_MS } from "./protocol.js";

const CONTAINER_COUNT = 16;
const SYNTHETIC_IO_DELAY_MS = 25;

function containerId(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function inspectEvidence(id: string, index: number) {
  return {
    Id: id,
    Name: `/service-${index}`,
    Image: `sha256:image-${index}`,
    Created: "2026-08-18T00:00:00.000Z",
    RestartCount: 0,
    Config: { Image: `example/service-${index}:latest` },
    State: {
      Status: "running",
      Running: true,
      StartedAt: "2026-08-18T00:01:00.000Z",
    },
  };
}

function statsEvidence() {
  return {
    cpu_stats: {
      cpu_usage: { total_usage: 300, percpu_usage: [1, 1, 1, 1] },
      system_cpu_usage: 1_000,
      online_cpus: 4,
    },
    precpu_stats: {
      cpu_usage: { total_usage: 200, percpu_usage: [1, 1, 1, 1] },
      system_cpu_usage: 800,
      online_cpus: 4,
    },
    memory_stats: {
      usage: 1_000,
      limit: 2_000,
      stats: { inactive_file: 100 },
    },
    pids_stats: { current: 4 },
  };
}

class BoundedLatencyTransport implements DockerBrokerTransport {
  activeContainerRequests = 0;
  maxContainerRequests = 0;

  async #bounded<T>(value: T): Promise<T> {
    this.activeContainerRequests += 1;
    this.maxContainerRequests = Math.max(
      this.maxContainerRequests,
      this.activeContainerRequests,
    );
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, SYNTHETIC_IO_DELAY_MS));
      return value;
    } finally {
      this.activeContainerRequests -= 1;
    }
  }

  async ping(): Promise<void> {}

  async version(): Promise<unknown> {
    return {
      Version: "29.6.1",
      ApiVersion: "1.55",
      MinAPIVersion: "1.40",
    };
  }

  async listContainers(): Promise<unknown> {
    return Array.from({ length: CONTAINER_COUNT }, (_, index) => ({ Id: containerId(index) }));
  }

  inspectContainer(id: string): Promise<unknown> {
    const index = Number.parseInt(id.slice(-2), 16);
    return this.#bounded(inspectEvidence(id, index));
  }

  statsContainer(_id: string): Promise<unknown> {
    return this.#bounded(statsEvidence());
  }
}

describe("Docker snapshot latency budget", () => {
  it("uses the broker's bounded eight-way capacity for a 16-container snapshot", async () => {
    const transport = new BoundedLatencyTransport();

    const snapshot = await runWithTimeout(
      (signal) => readDockerContainers(transport, signal),
      DOCKER_CONTAINERS_OPERATION_TIMEOUT_MS,
    );

    expect(DOCKER_CONTAINER_CONCURRENCY).toBe(8);
    expect(snapshot.containers).toHaveLength(CONTAINER_COUNT);
    expect(transport.maxContainerRequests).toBe(DOCKER_CONTAINER_CONCURRENCY);
    expect(transport.maxContainerRequests).toBeLessThanOrEqual(8);
  });
});
