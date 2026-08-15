import { describe, expect, it } from "vitest";

import { normalizePrometheusMatrix } from "./prometheus-normalize.js";

function matrix(values: unknown[]) {
  return {
    status: "success",
    data: {
      resultType: "matrix",
      result: [{ metric: { instance: "private:9100" }, values }],
    },
  };
}

describe("Prometheus matrix normalization", () => {
  it("projects only finite points and drops upstream labels", () => {
    const result = normalizePrometheusMatrix(
      matrix([
        [1_000, "12.5"],
        [1_030, "NaN"],
        [1_060, "13.75"],
      ]),
      "CPU_PERCENT",
      1_000,
      1_060,
      121,
    );

    expect(result).toEqual({
      metric: "CPU_PERCENT",
      state: "AVAILABLE",
      points: [
        { timestamp: "1970-01-01T00:16:40.000Z", value: 12.5 },
        { timestamp: "1970-01-01T00:17:40.000Z", value: 13.75 },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private:9100");
  });

  it("uses UNAVAILABLE for a valid empty series or only non-finite samples", () => {
    expect(
      normalizePrometheusMatrix(
        { status: "success", data: { resultType: "matrix", result: [] } },
        "LOAD1",
        1_000,
        1_060,
        121,
      ),
    ).toEqual({ metric: "LOAD1", state: "UNAVAILABLE", points: [] });

    expect(
      normalizePrometheusMatrix(matrix([[1_000, "+Inf"]]), "LOAD1", 1_000, 1_060, 121),
    ).toEqual({ metric: "LOAD1", state: "UNAVAILABLE", points: [] });
  });

  it("fails closed for malformed, out-of-order, oversized or out-of-domain data", () => {
    expect(() =>
      normalizePrometheusMatrix(
        { status: "success", data: { resultType: "vector", result: [] } },
        "LOAD1",
        1_000,
        1_060,
        121,
      ),
    ).toThrow("Prometheus source unavailable");

    expect(() =>
      normalizePrometheusMatrix(
        matrix([
          [1_030, "1"],
          [1_000, "2"],
        ]),
        "LOAD1",
        1_000,
        1_060,
        121,
      ),
    ).toThrow("Prometheus source unavailable");

    expect(() =>
      normalizePrometheusMatrix(matrix([[1_000, "101"]]), "CPU_PERCENT", 1_000, 1_060, 121),
    ).toThrow("Prometheus source unavailable");

    expect(() =>
      normalizePrometheusMatrix(
        matrix(Array.from({ length: 122 }, (_, index) => [1_000 + index, "1"])),
        "LOAD1",
        1_000,
        2_000,
        121,
      ),
    ).toThrow("Prometheus source unavailable");
  });
});
