import { describe, expect, it } from "vitest";

import {
  createDockerHistoryReader,
  DOCKER_HISTORY_QUERY_SERIES_LIMIT,
} from "./docker-history.js";
import type { PrometheusQueryRangeRequest, PrometheusTransport } from "./prometheus-types.js";

function series(
  project: string,
  service: string,
  number: string,
  start: number,
  end: number,
  first: string,
  second: string,
) {
  return {
    metric: {
      __name__: "private-upstream-name",
      instance: "private-upstream:9464",
      job: "dashboard-rpi5-container-metrics",
      compose_project: project,
      compose_service: service,
      compose_container_number: number,
    },
    values: [
      [start, first],
      [end, second],
    ],
  };
}

function matrix(result: unknown[]) {
  return { status: "success", data: { resultType: "matrix", result } };
}

describe("Docker history reader", () => {
  it("owns fixed CPU/memory queries, bounds source series, and returns top five by average", async () => {
    const requests: PrometheusQueryRangeRequest[] = [];
    const transport: PrometheusTransport = {
      async read(request) {
        requests.push(request);
        const multiplier = request.query.includes("memory_working_set") ? 1024 : 1;
        return matrix(
          Array.from({ length: 6 }, (_, index) =>
            series(
              "home",
              `service-${index + 1}`,
              "1",
              request.startEpochSeconds,
              request.endEpochSeconds,
              String((index + 1) * multiplier),
              String((index + 2) * multiplier),
            ),
          ),
        );
      },
    };
    const reader = createDockerHistoryReader({
      transport,
      now: () => new Date("2026-09-25T12:00:00.000Z"),
    });

    const snapshot = await reader("24h");

    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.stepSeconds === 300)).toBe(true);
    expect(requests.every((request) => request.maxSeries === DOCKER_HISTORY_QUERY_SERIES_LIMIT)).toBe(
      true,
    );
    expect(requests.map((request) => request.query)).toEqual([
      '100 * rate(container_cpu_usage_seconds_total{job="dashboard-rpi5-container-metrics"}[5m])',
      'container_memory_working_set_bytes{job="dashboard-rpi5-container-metrics"}',
    ]);
    expect(snapshot.rankings).toHaveLength(2);
    expect(snapshot.rankings[0]?.state).toBe("AVAILABLE");
    expect(snapshot.rankings[0]?.consumers).toHaveLength(5);
    expect(snapshot.rankings[0]?.consumers[0]?.identity.composeService).toBe("service-6");
    expect(JSON.stringify(snapshot)).not.toContain("private-upstream");
  });

  it("keeps an empty metric explicit as UNAVAILABLE without fabricating zero", async () => {
    const transport: PrometheusTransport = {
      async read(request) {
        if (request.query.includes("memory_working_set")) return matrix([]);
        return matrix([
          series(
            "home",
            "api",
            "1",
            request.startEpochSeconds,
            request.endEpochSeconds,
            "1",
            "2",
          ),
        ]);
      },
    };
    const reader = createDockerHistoryReader({
      transport,
      now: () => new Date("2026-09-25T12:00:00.000Z"),
    });

    const snapshot = await reader("1h");
    expect(snapshot.rankings.find((ranking) => ranking.metric === "MEMORY_WORKING_SET_BYTES")).toEqual({
      metric: "MEMORY_WORKING_SET_BYTES",
      state: "UNAVAILABLE",
      consumers: [],
    });
  });

  it("fails closed on duplicate logical identity", async () => {
    const transport: PrometheusTransport = {
      async read(request) {
        const duplicate = series(
          "home",
          "api",
          "1",
          request.startEpochSeconds,
          request.endEpochSeconds,
          "1",
          "2",
        );
        return matrix([duplicate, { ...duplicate, metric: { ...duplicate.metric, instance: "other:9464" } }]);
      },
    };
    const reader = createDockerHistoryReader({ transport });
    await expect(reader("1h")).rejects.toThrow("Prometheus source unavailable");
  });

  it("uses the 65th series only as an overflow sentinel and rejects it", async () => {
    const transport: PrometheusTransport = {
      async read(request) {
        return matrix(
          Array.from({ length: DOCKER_HISTORY_QUERY_SERIES_LIMIT }, (_, index) =>
            series(
              "home",
              `service-${index + 1}`,
              "1",
              request.startEpochSeconds,
              request.endEpochSeconds,
              "1",
              "2",
            ),
          ),
        );
      },
    };
    const reader = createDockerHistoryReader({ transport });
    await expect(reader("7d")).rejects.toThrow("Prometheus source unavailable");
  });
});
