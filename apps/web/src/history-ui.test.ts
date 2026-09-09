import type { HostHistoryMetric, HostHistorySeries, HostHistorySnapshot } from "@dashboard-rpi5/contracts/history";
import { describe, expect, it } from "vitest";

import {
  buildSparklinePoints,
  formatHistoryValue,
  getSeriesStats,
  HISTORY_METRICS,
  parseHostHistorySnapshot,
} from "./history-ui";

const timestamp = "2026-08-15T10:10:00.000Z";
const metricValues: Record<HostHistoryMetric, number> = {
  CPU_PERCENT: 15,
  CPU_USER_PERCENT: 9,
  CPU_SYSTEM_PERCENT: 4,
  CPU_IOWAIT_PERCENT: 2,
  MEMORY_PERCENT: 48,
  SWAP_PERCENT: 7,
  ROOT_FS_PERCENT: 54,
  LOAD1: 0.42,
  SOC_TEMP_CELSIUS: 55.5,
  NVME_TEMP_CELSIUS: 49.8,
  FAN_RPM: 1200,
  FAN_PWM_PERCENT: 25,
  NETWORK_RX_BYTES_PER_SECOND: 1_048_576,
  NETWORK_TX_BYTES_PER_SECOND: 262_144,
  DISK_READ_BYTES_PER_SECOND: 131_072,
  DISK_WRITE_BYTES_PER_SECOND: 65_536,
  UPTIME_SECONDS: 183_845,
};

const cpuSeries: HostHistorySeries = {
  metric: "CPU_PERCENT",
  state: "AVAILABLE",
  points: [
    { timestamp: "2026-08-15T10:00:00.000Z", value: 10 },
    { timestamp: "2026-08-15T10:05:00.000Z", value: 25 },
    { timestamp, value: 15 },
  ],
};

function historySeries(metric: HostHistoryMetric): HostHistorySeries {
  if (metric === "ROOT_FS_PERCENT") return { metric, state: "UNAVAILABLE", points: [] };
  if (metric === "CPU_PERCENT") return cpuSeries;
  return { metric, state: "AVAILABLE", points: [{ timestamp, value: metricValues[metric] }] };
}

const snapshot: HostHistorySnapshot = {
  observedAt: timestamp,
  range: "24h",
  windowStart: "2026-08-14T10:10:00.000Z",
  windowEnd: timestamp,
  series: HISTORY_METRICS.map(historySeries),
  grafanaHref: "https://grafana.example.test/d/rpi5/host?from=now-24h&to=now",
};

describe("host history UI helpers", () => {
  it("derives latest/min/max without fabricating unavailable values", () => {
    expect(getSeriesStats(cpuSeries)).toEqual({ latest: 15, minimum: 10, maximum: 25 });
    expect(getSeriesStats({ metric: "ROOT_FS_PERCENT", state: "UNAVAILABLE", points: [] })).toBeNull();
  });

  it("uses metric-aware chart domains instead of treating rates as percentages", () => {
    expect(buildSparklinePoints(cpuSeries)).toBe("0.00,43.20 80.00,36.00 160.00,40.80");
    const networkSeries: HostHistorySeries = {
      metric: "NETWORK_RX_BYTES_PER_SECOND",
      state: "AVAILABLE",
      points: [
        { timestamp: "2026-08-15T10:00:00.000Z", value: 100 },
        { timestamp, value: 200 },
      ],
    };
    expect(buildSparklinePoints(networkSeries)).toBe("0.00,24.00 160.00,0.00");
  });

  it("keeps numeric summaries readable across every metric class", () => {
    expect(formatHistoryValue("CPU_PERCENT", 15.24)).toBe("15.2%");
    expect(formatHistoryValue("LOAD1", 0.426)).toBe("0.43");
    expect(formatHistoryValue("SOC_TEMP_CELSIUS", 55.56)).toBe("55.6°C");
    expect(formatHistoryValue("FAN_RPM", 1234.4)).toBe("1234 RPM");
    expect(formatHistoryValue("NETWORK_RX_BYTES_PER_SECOND", 1_048_576)).toBe("1.00 MiB/s");
    expect(formatHistoryValue("UPTIME_SECONDS", 183_845)).toBe("2d 3h");
  });

  it("accepts exactly the complete reviewed metric set", () => {
    expect(parseHostHistorySnapshot(snapshot)).toEqual(snapshot);
    expect(() => parseHostHistorySnapshot({ ...snapshot, series: snapshot.series.slice(0, -1) })).toThrow(
      "Invalid history response",
    );
  });

  it("rejects fake available-empty, duplicate and unknown metric evidence", () => {
    expect(() =>
      parseHostHistorySnapshot({
        ...snapshot,
        series: snapshot.series.map((series) =>
          series.metric === "CPU_PERCENT" ? { ...series, points: [] } : series,
        ),
      }),
    ).toThrow("Invalid history response");

    const duplicate = [...snapshot.series];
    duplicate[1] = snapshot.series[0]!;
    expect(() => parseHostHistorySnapshot({ ...snapshot, series: duplicate })).toThrow(
      "Invalid history response",
    );

    const unknown = [...snapshot.series];
    unknown[unknown.length - 1] = {
      ...snapshot.series.at(-1)!,
      metric: "NOT_REGISTERED",
    } as unknown as HostHistorySeries;
    expect(() => parseHostHistorySnapshot({ ...snapshot, series: unknown })).toThrow(
      "Invalid history response",
    );
  });
});
