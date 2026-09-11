import { describe, expect, it } from "vitest";

import {
  CONTAINER_METRICS_SNAPSHOT_SCHEMA,
  parseContainerMetricsSnapshot,
} from "./container-metrics-contract.js";
import {
  createDockerContainerMetricsReader,
  type DockerContainerMetricsEngineReader,
} from "./docker-broker-container-metrics.js";

const ID_A = "a".repeat(64);
const ID_B = "b".repeat(64);

function inspect(
  id: string,
  project: string | null = "dash",
  service: string | null = "web",
  containerNumber: string | null = "1",
) {
  const labels: Record<string, string> = {};
  if (project !== null) labels["com.docker.compose.project"] = project;
  if (service !== null) labels["com.docker.compose.service"] = service;
  if (containerNumber !== null) labels["com.docker.compose.container-number"] = containerNumber;
  return {
    Id: id,
    State: { Running: true },
    Config: { Labels: labels },
  };
}

function stats() {
  return {
    cpu_stats: { cpu_usage: { total_usage: 2_500_000_000 } },
    memory_stats: {
      usage: 1_000,
      stats: { inactive_file: 250 },
    },
    networks: {
      eth0: { rx_bytes: 100, tx_bytes: 200 },
      eth1: { rx_bytes: 3, tx_bytes: 4 },
    },
    blkio_stats: {
      io_service_bytes_recursive: [
        { op: "Read", value: 10 },
        { op: "Write", value: 20 },
        { op: "Read", value: 5 },
        { op: "Total", value: 999 },
      ],
    },
  };
}

function reader(
  ids: string[],
  inspectValues: Record<string, unknown>,
  statsValues: Record<string, unknown>,
  statsCalls: string[] = [],
): DockerContainerMetricsEngineReader {
  return {
    async listContainers() {
      return ids.map((Id) => ({ Id }));
    },
    async inspectContainer(id) {
      return inspectValues[id];
    },
    async statsContainer(id) {
      statsCalls.push(id);
      return statsValues[id];
    },
  };
}

describe("bounded broker container metrics snapshot", () => {
  it("normalizes only reviewed identity and metric evidence", async () => {
    const source = reader([ID_A], { [ID_A]: inspect(ID_A) }, { [ID_A]: stats() });
    const snapshot = await createDockerContainerMetricsReader(source, {
      now: () => new Date("2026-09-10T18:00:00.000Z"),
    }).readSnapshot();

    expect(snapshot).toEqual({
      schema: CONTAINER_METRICS_SNAPSHOT_SCHEMA,
      observedAt: "2026-09-10T18:00:00.000Z",
      containers: [
        {
          identity: {
            composeProject: "dash",
            composeService: "web",
            composeContainerNumber: "1",
          },
          cpuUsageSeconds: 2.5,
          memoryWorkingSetBytes: 750,
          networkReceiveBytes: 103,
          networkTransmitBytes: 204,
          filesystemReadBytes: 15,
          filesystemWriteBytes: 20,
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain(ID_A);
  });

  it("does not read stats or fabricate history for missing or malformed Compose identity", async () => {
    const statsCalls: string[] = [];
    const source = reader(
      [ID_A, ID_B],
      {
        [ID_A]: inspect(ID_A, "dash", null, "1"),
        [ID_B]: inspect(ID_B, "Dash With Spaces", "web", "1"),
      },
      { [ID_A]: stats(), [ID_B]: stats() },
      statsCalls,
    );

    const snapshot = await createDockerContainerMetricsReader(source).readSnapshot();
    expect(snapshot.containers).toEqual([]);
    expect(statsCalls).toEqual([]);
  });

  it("fails closed for duplicate logical identity before reading metric evidence", async () => {
    const statsCalls: string[] = [];
    const source = reader(
      [ID_A, ID_B],
      {
        [ID_A]: inspect(ID_A, "dash", "web", "1"),
        [ID_B]: inspect(ID_B, "dash", "web", "1"),
      },
      { [ID_A]: stats(), [ID_B]: stats() },
      statsCalls,
    );

    const snapshot = await createDockerContainerMetricsReader(source).readSnapshot();
    expect(snapshot.containers).toEqual([]);
    expect(statsCalls).toEqual([]);
  });

  it("fails the snapshot on malformed metric evidence and caps configured concurrency", async () => {
    const malformed = stats();
    (malformed.networks.eth0 as { rx_bytes: unknown }).rx_bytes = "not-a-number";
    const source = reader([ID_A], { [ID_A]: inspect(ID_A) }, { [ID_A]: malformed });

    await expect(
      createDockerContainerMetricsReader(source, { concurrency: 999 }).readSnapshot(),
    ).rejects.toThrow(/malformed Docker/u);
  });

  it("strictly rejects exporter-side duplicate identity and unknown payload keys", () => {
    const sample = {
      identity: {
        composeProject: "dash",
        composeService: "web",
        composeContainerNumber: "1",
      },
      cpuUsageSeconds: 1,
      memoryWorkingSetBytes: 2,
      networkReceiveBytes: 3,
      networkTransmitBytes: 4,
      filesystemReadBytes: 5,
      filesystemWriteBytes: 6,
    };
    expect(() =>
      parseContainerMetricsSnapshot({
        schema: CONTAINER_METRICS_SNAPSHOT_SCHEMA,
        observedAt: "2026-09-10T18:00:00.000Z",
        containers: [sample, sample],
      }),
    ).toThrow(/duplicate/u);
    expect(() =>
      parseContainerMetricsSnapshot({
        schema: CONTAINER_METRICS_SNAPSHOT_SCHEMA,
        observedAt: "2026-09-10T18:00:00.000Z",
        containers: [{ ...sample, dockerId: ID_A }],
      }),
    ).toThrow(/invalid/u);
  });
});
