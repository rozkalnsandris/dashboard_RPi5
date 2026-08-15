import { describe, expect, it } from "vitest";

import {
  DOCKER_API_PREFIX,
  DockerSourceUnavailableError,
  calculateDockerBlockIo,
  calculateDockerCpuPercent,
  calculateDockerMemory,
  calculateDockerNetwork,
  isAllowedDockerPath,
  parseDockerContainerIds,
  parseDockerStats,
  parseDockerVersion,
  readDockerContainers,
  type DockerTransport,
} from "./docker-read.js";

const RUNNING_ID = "a".repeat(64);
const STOPPED_ID = "b".repeat(64);

class FakeDockerTransport implements DockerTransport {
  readonly paths: string[] = [];

  constructor(readonly responses: Map<string, unknown>) {}

  async get(path: string): Promise<unknown> {
    this.paths.push(path);
    const response = this.responses.get(path);
    if (response instanceof Error) throw response;
    if (response === undefined) throw new Error(`unexpected path: ${path}`);
    return response;
  }
}

const versionEvidence = {
  Version: "29.6.1",
  ApiVersion: "1.55",
  MinAPIVersion: "1.40",
  ignoredFutureField: true,
};

function runningInspect() {
  return {
    Id: RUNNING_ID,
    Name: "/homeassistant",
    Image: "sha256:1234",
    Created: "2026-08-01T00:00:00.000Z",
    RestartCount: 3,
    Config: { Image: "ghcr.io/home-assistant/home-assistant:stable" },
    State: {
      Status: "running",
      Running: true,
      StartedAt: "2026-08-15T12:00:00.000Z",
      Health: { Status: "healthy" },
    },
    ignoredFutureField: { nested: true },
  };
}

function stoppedInspect() {
  return {
    Id: STOPPED_ID,
    Name: "/old-job",
    Image: "sha256:5678",
    Created: "2026-07-01T00:00:00.000Z",
    RestartCount: 0,
    Config: { Image: "busybox:latest" },
    State: {
      Status: "exited",
      Running: false,
      StartedAt: "0001-01-01T00:00:00Z",
    },
  };
}

function runningStats() {
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
      stats: { inactive_file: 100, total_inactive_file: 200, cache: 300 },
    },
    networks: {
      eth0: { rx_bytes: 10, tx_bytes: 20 },
      eth1: { rx_bytes: 30, tx_bytes: 40 },
    },
    blkio_stats: {
      io_service_bytes_recursive: [
        { op: "Read", value: 100 },
        { op: "Write", value: 200 },
        { op: "Sync", value: 999 },
        { op: "read", value: 50 },
      ],
    },
    pids_stats: { current: 12 },
  };
}

describe("Docker path allowlist", () => {
  it("allows only the fixed read-only API paths", () => {
    expect(isAllowedDockerPath(`${DOCKER_API_PREFIX}/version`)).toBe(true);
    expect(isAllowedDockerPath(`${DOCKER_API_PREFIX}/containers/json?all=true`)).toBe(true);
    expect(isAllowedDockerPath(`${DOCKER_API_PREFIX}/containers/${RUNNING_ID}/json`)).toBe(true);
    expect(
      isAllowedDockerPath(
        `${DOCKER_API_PREFIX}/containers/${RUNNING_ID}/stats?stream=false`,
      ),
    ).toBe(true);

    expect(isAllowedDockerPath(`${DOCKER_API_PREFIX}/containers/${RUNNING_ID}/stop`)).toBe(false);
    expect(isAllowedDockerPath(`${DOCKER_API_PREFIX}/containers/../json`)).toBe(false);
    expect(isAllowedDockerPath(`/v1.55/containers/json?all=true`)).toBe(false);
  });
});

describe("Docker version and inventory parsing", () => {
  it("accepts a daemon whose supported range includes API v1.40", () => {
    expect(parseDockerVersion(versionEvidence)).toEqual({
      engineVersion: "29.6.1",
      daemonApiVersion: "1.55",
      daemonMinApiVersion: "1.40",
    });
  });

  it("fails closed when the daemon no longer supports API v1.40", () => {
    expect(() =>
      parseDockerVersion({
        Version: "future",
        ApiVersion: "1.60",
        MinAPIVersion: "1.41",
      }),
    ).toThrow(DockerSourceUnavailableError);
  });

  it("rejects malformed daemon-provided container IDs", () => {
    expect(() => parseDockerContainerIds([{ Id: "../../etc/passwd" }])).toThrow(
      DockerSourceUnavailableError,
    );
  });
});

describe("Docker stats normalization", () => {
  it("uses Docker's documented multi-CPU formula without forcing 100% as a ceiling", () => {
    expect(calculateDockerCpuPercent(runningStats())).toBe(200);
  });

  it("returns null for non-monotonic or zero-system CPU evidence", () => {
    expect(
      calculateDockerCpuPercent({
        cpu_stats: { cpu_usage: { total_usage: 10 }, system_cpu_usage: 100, online_cpus: 4 },
        precpu_stats: { cpu_usage: { total_usage: 20 }, system_cpu_usage: 100 },
      }),
    ).toBeNull();
  });

  it("prefers cgroup v2 inactive_file, then v1 total_inactive_file, then legacy cache", () => {
    expect(calculateDockerMemory(runningStats())).toEqual({
      usedBytes: 900,
      limitBytes: 2_000,
      percent: 45,
    });

    expect(
      calculateDockerMemory({
        memory_stats: { usage: 1_000, limit: 2_000, stats: { total_inactive_file: 250 } },
      }),
    ).toEqual({ usedBytes: 750, limitBytes: 2_000, percent: 37.5 });

    expect(
      calculateDockerMemory({
        memory_stats: { usage: 1_000, limit: 2_000, stats: { cache: 400 } },
      }),
    ).toEqual({ usedBytes: 600, limitBytes: 2_000, percent: 30 });
  });

  it("aggregates network and block I/O without counting unrelated operations", () => {
    expect(calculateDockerNetwork(runningStats())).toEqual({ rxBytes: 40, txBytes: 60 });
    expect(calculateDockerBlockIo(runningStats())).toEqual({
      readBytes: 150,
      writeBytes: 200,
    });
  });

  it("produces the normalized resource contract", () => {
    expect(parseDockerStats(runningStats())).toEqual({
      cpuPercent: 200,
      memoryUsedBytes: 900,
      memoryLimitBytes: 2_000,
      memoryPercent: 45,
      networkRxBytes: 40,
      networkTxBytes: 60,
      blockReadBytes: 150,
      blockWriteBytes: 200,
      pids: 12,
    });
  });
});

describe("Docker container snapshot", () => {
  it("uses only daemon IDs for inspect/stats paths and skips stats for stopped containers", async () => {
    const transport = new FakeDockerTransport(
      new Map<string, unknown>([
        [`${DOCKER_API_PREFIX}/version`, versionEvidence],
        [
          `${DOCKER_API_PREFIX}/containers/json?all=true`,
          [{ Id: STOPPED_ID }, { Id: RUNNING_ID }],
        ],
        [`${DOCKER_API_PREFIX}/containers/${RUNNING_ID}/json`, runningInspect()],
        [`${DOCKER_API_PREFIX}/containers/${RUNNING_ID}/stats?stream=false`, runningStats()],
        [`${DOCKER_API_PREFIX}/containers/${STOPPED_ID}/json`, stoppedInspect()],
      ]),
    );

    const snapshot = await readDockerContainers(
      transport,
      undefined,
      () => new Date("2026-08-15T14:00:00.000Z"),
    );

    expect(snapshot).toMatchObject({
      observedAt: "2026-08-15T14:00:00.000Z",
      apiVersion: "1.40",
      engineVersion: "29.6.1",
      daemonApiVersion: "1.55",
      daemonMinApiVersion: "1.40",
    });

    expect(snapshot.containers).toHaveLength(2);
    expect(snapshot.containers.find((container) => container.id === RUNNING_ID)).toMatchObject({
      name: "homeassistant",
      state: "RUNNING",
      health: "HEALTHY",
      restartCount: 3,
      startedAt: "2026-08-15T12:00:00.000Z",
      uptimeSeconds: 7_200,
      statsState: "AVAILABLE",
      stats: { cpuPercent: 200, memoryUsedBytes: 900, pids: 12 },
    });
    expect(snapshot.containers.find((container) => container.id === STOPPED_ID)).toMatchObject({
      name: "old-job",
      state: "EXITED",
      health: "NONE",
      startedAt: null,
      uptimeSeconds: null,
      statsState: "NOT_RUNNING",
      stats: null,
    });

    expect(transport.paths).not.toContain(
      `${DOCKER_API_PREFIX}/containers/${STOPPED_ID}/stats?stream=false`,
    );
    expect(transport.paths.every(isAllowedDockerPath)).toBe(true);
  });

  it("marks one running container's stats unavailable without fabricating zeros", async () => {
    const transport = new FakeDockerTransport(
      new Map<string, unknown>([
        [`${DOCKER_API_PREFIX}/version`, versionEvidence],
        [`${DOCKER_API_PREFIX}/containers/json?all=true`, [{ Id: RUNNING_ID }]],
        [`${DOCKER_API_PREFIX}/containers/${RUNNING_ID}/json`, runningInspect()],
        [
          `${DOCKER_API_PREFIX}/containers/${RUNNING_ID}/stats?stream=false`,
          new Error("stats unavailable"),
        ],
      ]),
    );

    const snapshot = await readDockerContainers(transport);
    expect(snapshot.containers[0]).toMatchObject({
      statsState: "UNAVAILABLE",
      stats: null,
    });
  });

  it("fails before constructing inspect paths for an invalid daemon ID", async () => {
    const transport = new FakeDockerTransport(
      new Map<string, unknown>([
        [`${DOCKER_API_PREFIX}/version`, versionEvidence],
        [`${DOCKER_API_PREFIX}/containers/json?all=true`, [{ Id: "not-an-id" }]],
      ]),
    );

    await expect(readDockerContainers(transport)).rejects.toBeInstanceOf(
      DockerSourceUnavailableError,
    );
    expect(transport.paths).toEqual([
      `${DOCKER_API_PREFIX}/version`,
      `${DOCKER_API_PREFIX}/containers/json?all=true`,
    ]);
  });
});
