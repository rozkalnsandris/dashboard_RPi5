import { describe, expect, it } from "vitest";

import { createHostHistoryReader } from "./host-history.js";
import type { PrometheusQueryRangeRequest, PrometheusTransport } from "./prometheus-types.js";

function matrix(start: number, end: number, value = "10") {
  return {
    status: "success",
    data: {
      resultType: "matrix",
      result: [
        {
          metric: { internal: "not-exposed" },
          values: [
            [start, value],
            [end, value],
          ],
        },
      ],
    },
  };
}

describe("host history reader", () => {
  it("owns the 24h window, step and four fixed Prometheus queries", async () => {
    const requests: PrometheusQueryRangeRequest[] = [];
    const transport: PrometheusTransport = {
      async read(request) {
        requests.push(request);
        return matrix(request.startEpochSeconds, request.endEpochSeconds);
      },
    };
    const observedAt = new Date("2026-08-15T12:00:00.000Z");
    const reader = createHostHistoryReader({
      transport,
      now: () => observedAt,
      grafanaBaseUrl: "https://grafana.rozkalns.net/",
      grafanaDashboardPath: "/d/rpi5-host/rpi5-host",
    });

    const snapshot = await reader("24h");

    expect(requests).toHaveLength(4);
    expect(requests.every((request) => request.stepSeconds === 300)).toBe(true);
    expect(requests.every((request) => request.endEpochSeconds === observedAt.getTime() / 1_000)).toBe(
      true,
    );
    expect(
      requests.every(
        (request) => request.startEpochSeconds === observedAt.getTime() / 1_000 - 86_400,
      ),
    ).toBe(true);
    expect(snapshot.range).toBe("24h");
    expect(snapshot.series.map((series) => series.metric)).toEqual([
      "CPU_PERCENT",
      "MEMORY_PERCENT",
      "ROOT_FS_PERCENT",
      "LOAD1",
    ]);
    expect(snapshot.grafanaHref).toBe(
      "https://grafana.rozkalns.net/d/rpi5-host/rpi5-host?from=now-24h&to=now",
    );
    expect(JSON.stringify(snapshot)).not.toContain("not-exposed");
  });

  it("keeps a missing registered metric explicit instead of fabricating zeros", async () => {
    const transport: PrometheusTransport = {
      async read(request) {
        if (request.query.includes("node_load1")) {
          return { status: "success", data: { resultType: "matrix", result: [] } };
        }
        return matrix(request.startEpochSeconds, request.endEpochSeconds);
      },
    };
    const reader = createHostHistoryReader({
      transport,
      now: () => new Date("2026-08-15T12:00:00.000Z"),
    });

    const snapshot = await reader("1h");
    expect(snapshot.series.at(-1)).toEqual({
      metric: "LOAD1",
      state: "UNAVAILABLE",
      points: [],
    });
  });

  it("normalizes any transport failure to SOURCE_UNAVAILABLE semantics", async () => {
    const transport: PrometheusTransport = {
      async read() {
        throw new Error("private upstream failure detail");
      },
    };
    const reader = createHostHistoryReader({ transport });

    await expect(reader("7d")).rejects.toThrow("Prometheus source unavailable");
  });
});
