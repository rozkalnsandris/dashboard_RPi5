import type { HostHistorySnapshot } from "@dashboard-rpi5/contracts/history";
import { describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import type { HostHistoryReader } from "./host-history.js";

const fixture: HostHistorySnapshot = {
  observedAt: "2026-08-15T12:00:00.000Z",
  range: "1h",
  windowStart: "2026-08-15T11:00:00.000Z",
  windowEnd: "2026-08-15T12:00:00.000Z",
  series: [
    { metric: "CPU_PERCENT", state: "UNAVAILABLE", points: [] },
    { metric: "MEMORY_PERCENT", state: "UNAVAILABLE", points: [] },
    { metric: "ROOT_FS_PERCENT", state: "UNAVAILABLE", points: [] },
    { metric: "LOAD1", state: "UNAVAILABLE", points: [] },
  ],
  grafanaHref: null,
};

describe("GET /api/history/host", () => {
  it("accepts only a preset range and returns the normalized snapshot", async () => {
    const historyReader: HostHistoryReader = async (range) => ({ ...fixture, range });
    const app = buildApp({ historyReader });

    try {
      const response = await app.inject({ method: "GET", url: "/api/history/host?range=24h" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ range: "24h", grafanaHref: null });
    } finally {
      await app.close();
    }
  });

  it("rejects unknown, additional and duplicate browser query fields", async () => {
    const historyReader: HostHistoryReader = async () => fixture;
    const app = buildApp({ historyReader });

    try {
      const badRange = await app.inject({ method: "GET", url: "/api/history/host?range=30d" });
      expect(badRange.statusCode).toBe(400);
      expect(badRange.json()).toEqual({ error: "INVALID_REQUEST" });

      const injectedQuery = await app.inject({
        method: "GET",
        url: "/api/history/host?range=1h&query=up",
      });
      expect(injectedQuery.statusCode).toBe(400);
      expect(injectedQuery.json()).toEqual({ error: "INVALID_REQUEST" });

      const duplicateRange = await app.inject({
        method: "GET",
        url: "/api/history/host?range=1h&range=24h",
      });
      expect(duplicateRange.statusCode).toBe(400);
      expect(duplicateRange.json()).toEqual({ error: "INVALID_REQUEST" });
    } finally {
      await app.close();
    }
  });

  it("normalizes upstream failures without exposing their message", async () => {
    const historyReader: HostHistoryReader = async () => {
      throw new Error("private upstream detail");
    };
    const app = buildApp({ historyReader });

    try {
      const response = await app.inject({ method: "GET", url: "/api/history/host?range=7d" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });
      expect(response.body).not.toContain("private upstream detail");
    } finally {
      await app.close();
    }
  });
});
