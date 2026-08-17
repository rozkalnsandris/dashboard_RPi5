import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { registerCurrentStateApiRoutes } from "./current-state-routes.js";

const hostPayload = {
  observedAt: "2026-08-17T18:00:00.000Z",
  uptimeSeconds: 60,
  loadAverage: { oneMinute: 0.1, fiveMinutes: 0.2, fifteenMinutes: 0.3 },
  cpu: { usagePercent: 10, sampleWindowMs: 250 },
  memory: {
    totalBytes: 8_000,
    availableBytes: 5_000,
    usedBytes: 3_000,
    usedPercent: 37.5,
    swapTotalBytes: 0,
    swapFreeBytes: 0,
    swapUsedBytes: 0,
    swapUsedPercent: null,
  },
  filesystem: { path: "/", totalBytes: 10_000, availableBytes: 6_000, usedBytes: 4_000, usedPercent: 40 },
  temperature: { celsius: 42 },
  throttle: {
    rawHex: "0x0",
    rawValue: 0,
    current: { underVoltage: false, armFrequencyCapped: false, throttled: false, softTemperatureLimit: false },
    occurred: { underVoltage: false, armFrequencyCapped: false, throttled: false, softTemperatureLimit: false },
  },
};

const dockerPayload = {
  observedAt: "2026-08-17T18:00:00.000Z",
  apiVersion: "1.40",
  engineVersion: "28.3.3",
  daemonApiVersion: "1.51",
  daemonMinApiVersion: "1.24",
  containers: [],
};

describe("current-state API routes", () => {
  it("returns normalized host and Docker snapshots with no-store caching", async () => {
    const app = Fastify();
    registerCurrentStateApiRoutes(app, {
      readHostSummary: async () => hostPayload,
      readDockerContainers: async () => dockerPayload,
    });

    const host = await app.inject({ method: "GET", url: "/api/current/host" });
    expect(host.statusCode).toBe(200);
    expect(host.headers["cache-control"]).toBe("no-store");
    expect(host.json()).toEqual(hostPayload);

    const docker = await app.inject({ method: "GET", url: "/api/current/docker" });
    expect(docker.statusCode).toBe(200);
    expect(docker.headers["cache-control"]).toBe("no-store");
    expect(docker.json()).toEqual(dockerPayload);

    await app.close();
  });

  it("fails closed without leaking agent error details", async () => {
    const app = Fastify();
    registerCurrentStateApiRoutes(app, {
      readHostSummary: async () => { throw new Error("private host detail"); },
      readDockerContainers: async () => { throw new Error("private docker detail"); },
    });

    const host = await app.inject({ method: "GET", url: "/api/current/host" });
    const docker = await app.inject({ method: "GET", url: "/api/current/docker" });
    expect(host.statusCode).toBe(503);
    expect(host.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });
    expect(docker.statusCode).toBe(503);
    expect(docker.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });

    await app.close();
  });
});
