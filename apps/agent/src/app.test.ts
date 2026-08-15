import { afterEach, describe, expect, it } from "vitest";

import { buildAgentApp } from "./app.js";
import { HostSourceUnavailableError } from "./host-read.js";

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

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("agent health protocol", () => {
  it("returns the versioned source-only contract", async () => {
    const { app } = buildAgentApp({
      hostSummaryReader: async () => hostSummaryFixture,
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
      agentVersion: "0.3.0",
      capabilities: ["protocol.health", "host.summary"],
    });
    expect(new Date(payload.observedAt).toISOString()).toBe(payload.observedAt);
  });

  it("returns the purpose-built host summary contract", async () => {
    const { app } = buildAgentApp({
      hostSummaryReader: async () => hostSummaryFixture,
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/host/summary" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(hostSummaryFixture);
  });

  it("normalizes unavailable host evidence without leaking details", async () => {
    const { app } = buildAgentApp({
      hostSummaryReader: async () => {
        throw new HostSourceUnavailableError();
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/host/summary" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });
  });

  it("normalizes unknown routes without leaking internal details", async () => {
    const { app } = buildAgentApp({
      hostSummaryReader: async () => hostSummaryFixture,
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/not-real" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "NOT_FOUND" });
  });
});
