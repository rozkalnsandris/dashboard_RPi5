import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchCurrentDocker, fetchCurrentHost } from "./current-state-api";

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

afterEach(() => vi.unstubAllGlobals());

describe("current-state web API", () => {
  it("uses the fixed normalized routes and validates successful responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => hostPayload })
      .mockResolvedValueOnce({ ok: true, json: async () => dockerPayload });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCurrentHost()).resolves.toEqual(hostPayload);
    await expect(fetchCurrentDocker()).resolves.toEqual(dockerPayload);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/current/host");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/current/docker");
  });

  it("fails closed on HTTP errors and malformed payloads", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "SOURCE_UNAVAILABLE" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...dockerPayload, observedAt: "not-a-date" }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCurrentHost()).rejects.toThrow("Current-state evidence unavailable");
    await expect(fetchCurrentDocker()).rejects.toThrow("Invalid Docker containers response");
  });
});
