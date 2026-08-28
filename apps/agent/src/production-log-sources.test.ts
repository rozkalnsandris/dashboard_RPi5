import { describe, expect, it } from "vitest";

import {
  DOCKER_PRODUCTION_LOG_SOURCE_IDS,
  listProductionLogSources,
  PRODUCTION_LOG_SOURCE_IDS,
} from "./production-log-sources.js";
import { PRIVILEGED_LOG_SOURCE_IDS } from "./privileged-log-sources.js";

describe("production log source advertisement", () => {
  it("keeps privileged sources hidden until the reviewed feature gate is enabled", () => {
    expect(DOCKER_PRODUCTION_LOG_SOURCE_IDS).toEqual(["docker:homeassistant", "docker:prometheus"]);
    expect(PRODUCTION_LOG_SOURCE_IDS).toEqual([...DOCKER_PRODUCTION_LOG_SOURCE_IDS, ...PRIVILEGED_LOG_SOURCE_IDS]);
    const snapshot = listProductionLogSources(new Date("2026-08-28T08:00:00.000Z"), false);
    expect(snapshot.sources.map((source) => source.sourceId)).toEqual(["docker:homeassistant", "docker:prometheus"]);
    expect(snapshot.observedAt).toBe("2026-08-28T08:00:00.000Z");
  });

  it("advertises the fixed privileged registry only after the feature gate is enabled", () => {
    const snapshot = listProductionLogSources(new Date("2026-08-28T08:00:00.000Z"), true);
    expect(snapshot.sources.map((source) => source.sourceId)).toEqual(PRODUCTION_LOG_SOURCE_IDS);
    expect(snapshot.sources.some((source) => source.kind === "SYSTEMD")).toBe(true);
    expect(snapshot.sources.some((source) => source.kind === "JOURNAL")).toBe(true);
    expect(snapshot.sources.some((source) => source.kind === "FILE")).toBe(true);
  });
});
