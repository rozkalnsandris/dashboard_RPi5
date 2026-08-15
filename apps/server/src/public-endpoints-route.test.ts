import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const apps: ReturnType<typeof buildApp>[] = [];

const snapshot = {
  observedAt: "2026-08-15T20:10:00.000Z",
  health: "ATTENTION" as const,
  endpoints: [
    {
      endpointId: "grafana",
      label: "Grafana",
      state: "DOWN" as const,
      lastChangedAt: "2026-08-15T20:05:00.000Z",
      statusCode: 502,
      latencyMs: 1_240,
    },
  ],
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Phase 6B public endpoints API", () => {
  it("returns only normalized no-store endpoint state", async () => {
    const app = buildApp({ publicEndpointsReader: async () => snapshot });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/endpoints" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual(snapshot);

    for (const forbidden of [
      "https://",
      "http://",
      "/var/lib/dashboard-rpi5",
      "uptime-kuma",
      "Authorization",
      "Cookie",
      "token",
      "secret",
    ]) {
      expect(response.body).not.toContain(forbidden);
    }
  });

  it("rejects browser selectors instead of forwarding monitor or probe configuration", async () => {
    const app = buildApp({ publicEndpointsReader: async () => snapshot });
    apps.push(app);

    for (const url of [
      "/api/endpoints?url=https%3A%2F%2Fevil.example",
      "/api/endpoints?monitorId=12",
      "/api/endpoints?path=%2Fetc%2Fshadow",
      "/api/endpoints?timeout=999999",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(400);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toEqual({ error: "INVALID_REQUEST" });
    }
  });

  it("normalizes source failure without leaking agent or evidence details", async () => {
    const app = buildApp({
      publicEndpointsReader: async () => {
        throw new Error("private socket /var/lib/dashboard-rpi5/evidence/endpoints.json secret");
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/endpoints" });
    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });
    expect(response.body).not.toContain("private");
    expect(response.body).not.toContain("/var/lib");
    expect(response.body).not.toContain("secret");
  });
});
