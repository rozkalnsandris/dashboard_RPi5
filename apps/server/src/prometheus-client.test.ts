import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildPrometheusQueryRangeUrl,
  createPrometheusHttpTransport,
  parsePrometheusBaseUrl,
} from "./prometheus-client.js";
import { PROMETHEUS_MAX_RESPONSE_BYTES } from "./prometheus-types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Prometheus base URL and range request", () => {
  it("accepts only credential-free HTTP(S) server roots", () => {
    expect(parsePrometheusBaseUrl("http://127.0.0.1:9090/").toString()).toBe(
      "http://127.0.0.1:9090/",
    );
    expect(() => parsePrometheusBaseUrl("ftp://127.0.0.1:9090/")).toThrow();
    expect(() => parsePrometheusBaseUrl("http://user:secret@127.0.0.1:9090/")).toThrow();
    expect(() => parsePrometheusBaseUrl("http://127.0.0.1:9090/prometheus")).toThrow();
    expect(() => parsePrometheusBaseUrl("http://127.0.0.1:9090/?x=1")).toThrow();
  });

  it("constructs only the fixed query_range endpoint and bounded parameters", () => {
    const url = buildPrometheusQueryRangeUrl(new URL("http://127.0.0.1:9090/"), {
      query: "avg(node_load1)",
      startEpochSeconds: 1_000,
      endEpochSeconds: 4_600,
      stepSeconds: 30,
    });

    expect(url.pathname).toBe("/api/v1/query_range");
    expect(url.searchParams.get("query")).toBe("avg(node_load1)");
    expect(url.searchParams.get("start")).toBe("1000");
    expect(url.searchParams.get("end")).toBe("4600");
    expect(url.searchParams.get("step")).toBe("30s");
    expect(url.searchParams.get("timeout")).toBe("2s");
    expect(url.searchParams.get("limit")).toBe("1");
  });
});

describe("Prometheus HTTP transport", () => {
  it("normalizes non-2xx and malformed JSON without leaking the body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("private upstream detail", { status: 500 }))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = createPrometheusHttpTransport();
    const request = {
      query: "avg(node_load1)",
      startEpochSeconds: 1_000,
      endEpochSeconds: 4_600,
      stepSeconds: 30,
    };

    await expect(transport.read(request)).rejects.toThrow("Prometheus source unavailable");
    await expect(transport.read(request)).rejects.toThrow("Prometheus source unavailable");
  });

  it("rejects an oversized response body", async () => {
    const payload = new Uint8Array(PROMETHEUS_MAX_RESPONSE_BYTES + 1);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payload, { status: 200 })));

    const transport = createPrometheusHttpTransport();
    await expect(
      transport.read({
        query: "avg(node_load1)",
        startEpochSeconds: 1_000,
        endEpochSeconds: 4_600,
        stepSeconds: 30,
      }),
    ).rejects.toThrow("Prometheus source unavailable");
  });

  it("propagates caller cancellation as a normalized source failure", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn());

    const transport = createPrometheusHttpTransport();
    await expect(
      transport.read(
        {
          query: "avg(node_load1)",
          startEpochSeconds: 1_000,
          endEpochSeconds: 4_600,
          stepSeconds: 30,
        },
        controller.signal,
      ),
    ).rejects.toThrow("Prometheus source unavailable");
  });
});
