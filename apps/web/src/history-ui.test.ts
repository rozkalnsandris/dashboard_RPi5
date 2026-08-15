import type { HostHistorySeries, HostHistorySnapshot } from "@dashboard-rpi5/contracts/history";
import { describe, expect, it } from "vitest";

import {
  buildSparklinePoints,
  formatHistoryValue,
  getSeriesStats,
  parseHostHistorySnapshot,
} from "./history-ui";

const cpuSeries: HostHistorySeries = {
  metric: "CPU_PERCENT",
  state: "AVAILABLE",
  points: [
    { timestamp: "2026-08-15T10:00:00.000Z", value: 10 },
    { timestamp: "2026-08-15T10:05:00.000Z", value: 25 },
    { timestamp: "2026-08-15T10:10:00.000Z", value: 15 },
  ],
};

const snapshot: HostHistorySnapshot = {
  observedAt: "2026-08-15T10:10:00.000Z",
  range: "24h",
  windowStart: "2026-08-14T10:10:00.000Z",
  windowEnd: "2026-08-15T10:10:00.000Z",
  series: [
    cpuSeries,
    {
      metric: "MEMORY_PERCENT",
      state: "AVAILABLE",
      points: [{ timestamp: "2026-08-15T10:10:00.000Z", value: 48 }],
    },
    { metric: "ROOT_FS_PERCENT", state: "UNAVAILABLE", points: [] },
    {
      metric: "LOAD1",
      state: "AVAILABLE",
      points: [{ timestamp: "2026-08-15T10:10:00.000Z", value: 0.42 }],
    },
  ],
  grafanaHref: "https://grafana.example.test/d/rpi5/host?from=now-24h&to=now",
};

describe("Phase 4B history UI helpers", () => {
  it("derives latest/min/max without fabricating unavailable values", () => {
    expect(getSeriesStats(cpuSeries)).toEqual({ latest: 15, minimum: 10, maximum: 25 });
    expect(getSeriesStats({ metric: "ROOT_FS_PERCENT", state: "UNAVAILABLE", points: [] })).toBeNull();
  });

  it("builds a bounded sparkline and keeps numeric formatting visible", () => {
    expect(buildSparklinePoints(cpuSeries)).toBe("0.00,43.20 80.00,36.00 160.00,40.80");
    expect(formatHistoryValue("CPU_PERCENT", 15.24)).toBe("15.2%");
    expect(formatHistoryValue("LOAD1", 0.426)).toBe("0.43");
  });

  it("accepts the normalized snapshot and rejects fake available-empty evidence", () => {
    expect(parseHostHistorySnapshot(snapshot)).toEqual(snapshot);
    expect(() =>
      parseHostHistorySnapshot({
        ...snapshot,
        series: snapshot.series.map((series) =>
          series.metric === "CPU_PERCENT" ? { ...series, points: [] } : series,
        ),
      }),
    ).toThrow("Invalid history response");
  });

  it("rejects duplicate metric entries even when the array length is four", () => {
    expect(() =>
      parseHostHistorySnapshot({
        ...snapshot,
        series: [snapshot.series[0], snapshot.series[0], snapshot.series[2], snapshot.series[3]],
      }),
    ).toThrow("Invalid history response");
  });
});
