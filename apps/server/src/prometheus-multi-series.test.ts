import { describe, expect, it } from "vitest";

import { buildPrometheusQueryRangeUrl } from "./prometheus-client.js";
import { PROMETHEUS_MAX_QUERY_SERIES } from "./prometheus-types.js";

describe("bounded Prometheus multi-series requests", () => {
  it("keeps one series as the default and allows only the explicit bounded override", () => {
    const base = new URL("http://127.0.0.1:9090/");
    const request = {
      query: "container_memory_working_set_bytes",
      startEpochSeconds: 1_000,
      endEpochSeconds: 4_600,
      stepSeconds: 30,
    };
    expect(buildPrometheusQueryRangeUrl(base, request).searchParams.get("limit")).toBe("1");
    expect(
      buildPrometheusQueryRangeUrl(base, {
        ...request,
        maxSeries: PROMETHEUS_MAX_QUERY_SERIES,
      }).searchParams.get("limit"),
    ).toBe(String(PROMETHEUS_MAX_QUERY_SERIES));
    expect(() =>
      buildPrometheusQueryRangeUrl(base, {
        ...request,
        maxSeries: PROMETHEUS_MAX_QUERY_SERIES + 1,
      }),
    ).toThrow("Prometheus source unavailable");
  });
});
