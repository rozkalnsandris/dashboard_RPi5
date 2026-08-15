import { describe, expect, it } from "vitest";

import { parsePublicEndpointStatusSnapshot } from "./endpoints.js";

const up = {
  endpointId: "tech",
  label: "Hermes Tech",
  state: "UP" as const,
  lastChangedAt: "2026-08-15T20:00:00.000Z",
  statusCode: 200,
  latencyMs: 84,
};

const down = {
  endpointId: "grafana",
  label: "Grafana",
  state: "DOWN" as const,
  lastChangedAt: "2026-08-15T20:05:00.000Z",
  statusCode: 502,
  latencyMs: 1_240,
};

const base = {
  observedAt: "2026-08-15T20:10:00.000Z",
};

describe("public endpoint status contract", () => {
  it("accepts a correlated healthy snapshot", () => {
    expect(
      parsePublicEndpointStatusSnapshot({ ...base, health: "HEALTHY", endpoints: [up] }),
    ).toEqual({ ...base, health: "HEALTHY", endpoints: [up] });
  });

  it("re-derives attention and unknown instead of trusting the claimed health", () => {
    expect(
      parsePublicEndpointStatusSnapshot({ ...base, health: "ATTENTION", endpoints: [down, up] }).health,
    ).toBe("ATTENTION");
    expect(
      parsePublicEndpointStatusSnapshot({ ...base, health: "UNKNOWN", endpoints: [] }).health,
    ).toBe("UNKNOWN");
    expect(() =>
      parsePublicEndpointStatusSnapshot({ ...base, health: "HEALTHY", endpoints: [down] }),
    ).toThrow("Invalid public endpoint status");
  });

  it("keeps any unknown current endpoint from becoming all-clear", () => {
    expect(
      parsePublicEndpointStatusSnapshot({
        ...base,
        health: "UNKNOWN",
        endpoints: [{ ...up, endpointId: "kuma", label: "Uptime Kuma", state: "UNKNOWN" }],
      }).health,
    ).toBe("UNKNOWN");
  });

  it("rejects duplicate, future-dated or over-broad endpoint surfaces", () => {
    expect(() =>
      parsePublicEndpointStatusSnapshot({ ...base, health: "HEALTHY", endpoints: [up, up] }),
    ).toThrow("Invalid public endpoint status");
    expect(() =>
      parsePublicEndpointStatusSnapshot({
        ...base,
        health: "HEALTHY",
        endpoints: [{ ...up, lastChangedAt: "2026-08-15T20:10:01.000Z" }],
      }),
    ).toThrow("Invalid public endpoint status");
    expect(() =>
      parsePublicEndpointStatusSnapshot({
        ...base,
        health: "HEALTHY",
        endpoints: Array.from({ length: 9 }, (_, index) => ({
          ...up,
          endpointId: `endpoint-${index}`,
          label: `Endpoint ${index}`,
        })),
      }),
    ).toThrow("Invalid public endpoint status");
  });

  it("rejects private or unexpected fields", () => {
    expect(() =>
      parsePublicEndpointStatusSnapshot({
        ...base,
        health: "HEALTHY",
        endpoints: [{ ...up, url: "https://secret.example" }],
      }),
    ).toThrow("Invalid public endpoint status");
  });
});
