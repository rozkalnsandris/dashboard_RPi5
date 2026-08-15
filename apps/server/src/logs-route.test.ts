import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "./app.js";

const apps: ReturnType<typeof buildApp>[] = [];

const sources = {
  observedAt: "2026-08-15T15:00:00.000Z",
  sources: [
    {
      sourceId: "systemd:docker" as const,
      label: "Docker Engine",
      kind: "SYSTEMD" as const,
      rangeMode: "TIME" as const,
    },
  ],
};

const snapshot = {
  observedAt: "2026-08-15T15:00:00.000Z",
  source: sources.sources[0],
  range: "1h" as const,
  rangeApplied: true,
  entries: [
    {
      sequence: 0,
      timestamp: "2026-08-15T14:59:00.000Z",
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

describe("Phase 5B logs dashboard API", () => {
  it("returns registered sources and forwards only validated source/range enums", async () => {
    const logsReader = vi.fn(async () => snapshot);
    const app = buildApp({
      logSourcesReader: async () => sources,
      logsReader,
    });
    apps.push(app);

    const sourceResponse = await app.inject({ method: "GET", url: "/api/logs/sources" });
    expect(sourceResponse.statusCode).toBe(200);
    expect(sourceResponse.json()).toEqual(sources);

    const logsResponse = await app.inject({
      method: "GET",
      url: "/api/logs?sourceId=systemd%3Adocker&range=1h",
    });
    expect(logsResponse.statusCode).toBe(200);
    expect(logsResponse.json()).toEqual(snapshot);
    expect(logsReader).toHaveBeenCalledWith("systemd:docker", "1h");
  });

  it("rejects unknown source/range and every extra browser selector", async () => {
    const app = buildApp({
      logSourcesReader: async () => sources,
      logsReader: async () => snapshot,
    });
    apps.push(app);

    for (const url of [
      "/api/logs?sourceId=systemd%3Anot-real&range=1h",
      "/api/logs?sourceId=systemd%3Adocker&range=2h",
      "/api/logs?sourceId=systemd%3Adocker&range=1h&path=%2Fetc%2Fshadow",
      "/api/logs/sources?unit=ssh.service",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "INVALID_REQUEST" });
    }
  });

  it("normalizes source failures without leaking agent details", async () => {
    const app = buildApp({
      logSourcesReader: async () => {
        throw new Error("private socket detail");
      },
      logsReader: async () => {
        throw new Error("private journal detail");
      },
    });
    apps.push(app);

    const sourceResponse = await app.inject({ method: "GET", url: "/api/logs/sources" });
    expect(sourceResponse.statusCode).toBe(503);
    expect(sourceResponse.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });

    const logsResponse = await app.inject({
      method: "GET",
      url: "/api/logs?sourceId=systemd%3Adocker&range=1h",
    });
    expect(logsResponse.statusCode).toBe(503);
    expect(logsResponse.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });
  });
});
