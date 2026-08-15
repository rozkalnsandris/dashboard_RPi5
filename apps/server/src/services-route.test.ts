import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const apps: ReturnType<typeof buildApp>[] = [];

const snapshot = {
  observedAt: "2026-08-15T15:00:00.000Z",
  services: [
    {
      unitId: "docker.service",
      label: "Docker Engine",
      loadState: "LOADED" as const,
      activeState: "ACTIVE" as const,
      subState: "running",
      enablement: "ENABLED" as const,
      restartCount: 0,
      stateAgeSeconds: 120,
    },
  ],
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Phase 5A services dashboard API", () => {
  it("returns only the normalized services snapshot", async () => {
    const app = buildApp({ servicesReader: async () => snapshot });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/services" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(snapshot);
  });

  it("rejects browser-supplied selectors instead of ignoring them", async () => {
    const app = buildApp({ servicesReader: async () => snapshot });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/services?unit=ssh.service" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "INVALID_REQUEST" });
  });

  it("normalizes agent failures without leaking upstream details", async () => {
    const app = buildApp({
      servicesReader: async () => {
        throw new Error("private socket detail");
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/services" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });
  });
});
