import { describe, expect, it } from "vitest";

import { listProductionLogSources, PRODUCTION_LOG_SOURCE_IDS } from "./production-log-sources.js";

describe("production log source advertisement", () => {
  it("advertises only source IDs backed by the current least-privilege production authority", () => {
    expect(PRODUCTION_LOG_SOURCE_IDS).toEqual([
      "docker:homeassistant",
      "docker:prometheus",
    ]);

    const snapshot = listProductionLogSources(new Date("2026-08-23T08:00:00.000Z"));
    expect(snapshot.sources.map((source) => source.sourceId)).toEqual([
      "docker:homeassistant",
      "docker:prometheus",
    ]);

    expect(snapshot.sources.some((source) => source.kind === "SYSTEMD")).toBe(false);
    expect(snapshot.sources.some((source) => source.kind === "FILE")).toBe(false);
    expect(snapshot.observedAt).toBe("2026-08-23T08:00:00.000Z");
  });
});
