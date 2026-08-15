import { afterEach, describe, expect, it } from "vitest";

import { buildAgentApp } from "./app.js";
import { DockerSourceUnavailableError } from "./docker-read.js";
import { HostSourceUnavailableError } from "./host-read.js";
import { LogSourceUnavailableError } from "./logs-read.js";
import { SystemdSourceUnavailableError } from "./systemd-services.js";

const apps: ReturnType<typeof buildAgentApp>["app"][] = [];

const hostSummaryFixture = {
  observedAt: "2026-08-15T13:00:00.000Z",
  uptimeSeconds: 12345.67,
  loadAverage: { oneMinute: 0.25, fiveMinutes: 0.5, fifteenMinutes: 0.75 },
  cpu: { usagePercent: 37.5, sampleWindowMs: 200 },
  memory: {
    totalBytes: 8_589_934_592,
    availableBytes: 5_368_709_120,
    usedBytes: 3_221_225_472,
    usedPercent: 37.5,
    swapTotalBytes: 0,
    swapFreeBytes: 0,
    swapUsedBytes: 0,
    swapUsedPercent: null,
  },
  filesystem: {
    path: "/" as const,
    totalBytes: 4_096_000,
    availableBytes: 1_024_000,
    usedBytes: 3_072_000,
    usedPercent: 75,
  },
  temperature: { celsius: 43.2 },
  throttle: {
    rawHex: "0x0",
    rawValue: 0,
    current: {
      underVoltage: false,
      armFrequencyCapped: false,
      throttled: false,
      softTemperatureLimit: false,
    },
    occurred: {
      underVoltage: false,
      armFrequencyCapped: false,
      throttled: false,
      softTemperatureLimit: false,
    },
  },
};

const dockerContainersFixture = {
  observedAt: "2026-08-15T13:00:00.000Z",
  apiVersion: "1.40" as const,
  engineVersion: "29.6.1",
  daemonApiVersion: "1.55",
  daemonMinApiVersion: "1.40",
  containers: [
    {
      id: "a".repeat(64),
      name: "homeassistant",
      image: "ghcr.io/home-assistant/home-assistant:stable",
      imageId: "sha256:1234",
      createdAt: "2026-08-01T00:00:00.000Z",
      state: "RUNNING" as const,
      health: "HEALTHY" as const,
      restartCount: 1,
      startedAt: "2026-08-15T12:00:00.000Z",
      uptimeSeconds: 3_600,
      statsState: "AVAILABLE" as const,
      stats: {
        cpuPercent: 12.5,
        memoryUsedBytes: 500_000_000,
        memoryLimitBytes: 8_000_000_000,
        memoryPercent: 6.25,
        networkRxBytes: 100,
        networkTxBytes: 200,
        blockReadBytes: 300,
        blockWriteBytes: 400,
        pids: 12,
      },
    },
  ],
};

const dockerEventsFixture = {
  observedAt: "2026-08-15T13:00:00.000Z",
  windowStart: "2026-08-15T12:00:00.000Z",
  windowEnd: "2026-08-15T13:00:00.000Z",
  apiVersion: "1.40" as const,
  events: [
    {
      occurredAt: "2026-08-15T12:55:00.000Z",
      action: "RESTART" as const,
      containerId: "a".repeat(64),
      containerName: "homeassistant",
      image: "ghcr.io/home-assistant/home-assistant:stable",
      health: null,
      exitCode: null,
      signal: null,
      scope: "LOCAL" as const,
    },
  ],
};

const servicesFixture = {
  observedAt: "2026-08-15T13:00:00.000Z",
  services: [
    {
      unitId: "docker.service",
      label: "Docker Engine",
      loadState: "LOADED" as const,
      activeState: "ACTIVE" as const,
      subState: "running",
      enablement: "ENABLED" as const,
      restartCount: 1,
      stateAgeSeconds: 3_600,
    },
  ],
};

const logSourcesFixture = {
  observedAt: "2026-08-15T13:00:00.000Z",
  sources: [
    {
      sourceId: "systemd:docker" as const,
      label: "Docker Engine",
      kind: "SYSTEMD" as const,
      rangeMode: "TIME" as const,
    },
    {
      sourceId: "file:rpi5-backup" as const,
      label: "RPi5 backup",
      kind: "FILE" as const,
      rangeMode: "TAIL" as const,
    },
  ],
};

const logsFixture = {
  observedAt: "2026-08-15T13:00:00.000Z",
  source: logSourcesFixture.sources[0],
  range: "1h" as const,
  rangeApplied: true,
  entries: [
    {
      sequence: 0,
      timestamp: "2026-08-15T12:59:00.000Z",
      level: "INFO" as const,
      stream: "JOURNAL" as const,
      message: "Docker daemon ready",
    },
  ],
  truncated: false,
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("agent health protocol", () => {
  it("returns the versioned source-only contract", async () => {
    const { app } = buildAgentApp({
      hostSummaryReader: async () => hostSummaryFixture,
      dockerContainersReader: async () => dockerContainersFixture,
      dockerEventsReader: async () => dockerEventsFixture,
      servicesReader: async () => servicesFixture,
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/health" });
    expect(response.statusCode).toBe(200);

    const payload = response.json();
    expect(payload).toMatchObject({
      status: "ok",
      service: "dashboard-rpi5-agent",
      mode: "SOURCE_ONLY",
      protocolVersion: 1,
      agentVersion: "0.7.0",
      capabilities: [
        "protocol.health",
        "host.summary",
        "docker.containers",
        "docker.events.recent",
        "services.status",
        "logs.read",
      ],
    });
    expect(new Date(payload.observedAt).toISOString()).toBe(payload.observedAt);
  });

  it("returns the purpose-built host summary contract", async () => {
    const { app } = buildAgentApp({
      hostSummaryReader: async () => hostSummaryFixture,
      dockerContainersReader: async () => dockerContainersFixture,
      dockerEventsReader: async () => dockerEventsFixture,
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/host/summary" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(hostSummaryFixture);
  });

  it("returns the purpose-built Docker containers contract", async () => {
    const { app } = buildAgentApp({
      hostSummaryReader: async () => hostSummaryFixture,
      dockerContainersReader: async () => dockerContainersFixture,
      dockerEventsReader: async () => dockerEventsFixture,
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/docker/containers" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(dockerContainersFixture);
  });

  it("returns the bounded Docker recent-events contract", async () => {
    const { app } = buildAgentApp({
      hostSummaryReader: async () => hostSummaryFixture,
      dockerContainersReader: async () => dockerContainersFixture,
      dockerEventsReader: async () => dockerEventsFixture,
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/docker/events/recent" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(dockerEventsFixture);
  });

  it("returns the allowlisted systemd services contract", async () => {
    const { app } = buildAgentApp({ servicesReader: async () => servicesFixture });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/services" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(servicesFixture);
  });

  it("returns only registered log-source descriptors", async () => {
    const { app } = buildAgentApp({ logSourcesReader: () => logSourcesFixture });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/logs/sources" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(logSourcesFixture);
    expect(response.body).not.toContain("/var/log/");
    expect(response.body).not.toContain(".service\"");
  });

  it("returns a bounded log snapshot only for validated source and range enums", async () => {
    const calls: unknown[][] = [];
    const { app } = buildAgentApp({
      logsReader: async (sourceId, range, signal) => {
        calls.push([sourceId, range, signal.aborted]);
        return logsFixture;
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/logs?sourceId=systemd%3Adocker&range=1h",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(logsFixture);
    expect(calls).toEqual([["systemd:docker", "1h", false]]);

    const unknown = await app.inject({
      method: "GET",
      url: "/v1/logs?sourceId=systemd%3Anot-real&range=1h",
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toEqual({ error: "INVALID_OPERATION" });

    const extra = await app.inject({
      method: "GET",
      url: "/v1/logs?sourceId=systemd%3Adocker&range=1h&path=%2Fetc%2Fshadow",
    });
    expect(extra.statusCode).toBe(400);
    expect(extra.json()).toEqual({ error: "INVALID_OPERATION" });
  });

  it("normalizes unavailable host evidence without leaking details", async () => {
    const { app } = buildAgentApp({
      hostSummaryReader: async () => {
        throw new HostSourceUnavailableError();
      },
      dockerContainersReader: async () => dockerContainersFixture,
      dockerEventsReader: async () => dockerEventsFixture,
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/host/summary" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });
  });

  it("normalizes unavailable Docker evidence without leaking details", async () => {
    const { app } = buildAgentApp({
      hostSummaryReader: async () => hostSummaryFixture,
      dockerContainersReader: async () => {
        throw new DockerSourceUnavailableError();
      },
      dockerEventsReader: async () => dockerEventsFixture,
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/docker/containers" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });
  });

  it("normalizes unavailable Docker event evidence without leaking details", async () => {
    const { app } = buildAgentApp({
      hostSummaryReader: async () => hostSummaryFixture,
      dockerContainersReader: async () => dockerContainersFixture,
      dockerEventsReader: async () => {
        throw new DockerSourceUnavailableError();
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/docker/events/recent" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });
  });

  it("normalizes unavailable systemd evidence without leaking details", async () => {
    const { app } = buildAgentApp({
      servicesReader: async () => {
        throw new SystemdSourceUnavailableError();
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/services" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });
  });

  it("normalizes unavailable log evidence without leaking details", async () => {
    const { app } = buildAgentApp({
      logsReader: async () => {
        throw new LogSourceUnavailableError();
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/logs?sourceId=systemd%3Adocker&range=1h",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });
  });

  it("normalizes unknown routes without leaking internal details", async () => {
    const { app } = buildAgentApp({
      hostSummaryReader: async () => hostSummaryFixture,
      dockerContainersReader: async () => dockerContainersFixture,
      dockerEventsReader: async () => dockerEventsFixture,
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/not-real" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "NOT_FOUND" });
  });
});
