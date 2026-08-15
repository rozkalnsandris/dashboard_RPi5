import { describe, expect, it } from "vitest";

import { HISTORY_RANGE_POLICY, HOST_HISTORY_METRICS } from "./history-policy.js";
import { buildHostPromqlRegistry } from "./prometheus-query-registry.js";

describe("history range policy", () => {
  it("keeps the three browser-selectable windows bounded", () => {
    expect(HISTORY_RANGE_POLICY).toEqual({
      "1h": { durationSeconds: 3_600, stepSeconds: 30, maxPoints: 121 },
      "24h": { durationSeconds: 86_400, stepSeconds: 300, maxPoints: 289 },
      "7d": { durationSeconds: 604_800, stepSeconds: 1_800, maxPoints: 337 },
    });
    expect(HOST_HISTORY_METRICS).toEqual([
      "CPU_PERCENT",
      "MEMORY_PERCENT",
      "ROOT_FS_PERCENT",
      "LOAD1",
    ]);
  });
});

describe("fixed PromQL registry", () => {
  it("owns the host queries server-side", () => {
    const registry = buildHostPromqlRegistry();

    expect(registry.CPU_PERCENT).toContain("node_cpu_seconds_total");
    expect(registry.CPU_PERCENT).toContain('mode="idle"');
    expect(registry.MEMORY_PERCENT).toContain("node_memory_MemAvailable_bytes");
    expect(registry.ROOT_FS_PERCENT).toContain('mountpoint="/"');
    expect(registry.LOAD1).toBe("avg(node_load1)");
  });

  it("adds only an escaped server-side instance matcher", () => {
    const registry = buildHostPromqlRegistry('rpi5:9100\\"primary');

    expect(registry.CPU_PERCENT).toContain('instance="rpi5:9100\\\\\\"primary"');
    expect(registry.LOAD1).toContain('instance="rpi5:9100\\\\\\"primary"');
  });

  it("rejects control characters in the configured instance", () => {
    expect(() => buildHostPromqlRegistry("rpi5:9100\nother")).toThrow(
      "Prometheus source unavailable",
    );
  });
});
