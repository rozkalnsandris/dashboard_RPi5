import type { DockerTopConsumersSnapshot } from "@dashboard-rpi5/contracts/history";
import { describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import type { DockerHistoryReader } from "./docker-history.js";

const fixture: DockerTopConsumersSnapshot = {
  observedAt: "2026-09-25T12:00:00.000Z",
  range: "1h",
  windowStart: "2026-09-25T11:00:00.000Z",
  windowEnd: "2026-09-25T12:00:00.000Z",
  rankings: [
    { metric: "CPU_PERCENT", state: "UNAVAILABLE", consumers: [] },
    { metric: "MEMORY_WORKING_SET_BYTES", state: "UNAVAILABLE", consumers: [] },
  ],
};

describe("GET /api/history/docker/top", () => {
  it("accepts only the preset range and returns normalized Docker history", async () => {
    const dockerHistoryReader: DockerHistoryReader = async (range) => ({ ...fixture, range });
    const app = buildApp({ dockerHistoryReader });
    try {
      const response = await app.inject({ method: "GET", url: "/api/history/docker/top?range=24h" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ range: "24h" });
    } finally {
      await app.close();
    }
  });

  it("rejects arbitrary, additional, and duplicate browser query fields", async () => {
    const dockerHistoryReader: DockerHistoryReader = async () => fixture;
    const app = buildApp({ dockerHistoryReader });
    try {
      for (const url of [
        "/api/history/docker/top?range=30d",
        "/api/history/docker/top?range=1h&query=up",
        "/api/history/docker/top?range=1h&metric=CPU_PERCENT",
        "/api/history/docker/top?range=1h&range=24h",
      ]) {
        const response = await app.inject({ method: "GET", url });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: "INVALID_REQUEST" });
      }
    } finally {
      await app.close();
    }
  });

  it("normalizes upstream failures without exposing their message", async () => {
    const dockerHistoryReader: DockerHistoryReader = async () => {
      throw new Error("private upstream detail");
    };
    const app = buildApp({ dockerHistoryReader });
    try {
      const response = await app.inject({ method: "GET", url: "/api/history/docker/top?range=7d" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });
      expect(response.body).not.toContain("private upstream detail");
    } finally {
      await app.close();
    }
  });
});
