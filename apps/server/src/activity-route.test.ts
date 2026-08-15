import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const apps: ReturnType<typeof buildApp>[] = [];

const snapshot = {
  observedAt: "2026-08-15T17:00:00.000Z",
  sources: [
    { source: "DOCKER" as const, status: "AVAILABLE" as const, observedAt: "2026-08-15T17:00:00.000Z" },
    { source: "SYSTEMD" as const, status: "UNAVAILABLE" as const, observedAt: null },
    { source: "BACKUP" as const, status: "UNAVAILABLE" as const, observedAt: null },
    { source: "MAINTENANCE" as const, status: "UNAVAILABLE" as const, observedAt: null },
  ],
  items: [
    {
      id: `docker:${"a".repeat(64)}`,
      source: "DOCKER" as const,
      severity: "INFO" as const,
      kind: "DOCKER_START" as const,
      occurredAt: "2026-08-15T16:59:00.000Z",
      title: "homeassistant started",
      detail: "image homeassistant/home-assistant:stable · scope local",
      target: "/docker" as const,
      groupCount: 1,
    },
  ],
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Phase 5C-C Activity API", () => {
  it("returns no-store bounded activity evidence and rejects every browser selector", async () => {
    const app = buildApp({ activityReader: async () => snapshot });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/activity" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual(snapshot);

    for (const url of [
      "/api/activity?source=DOCKER",
      "/api/activity?since=1h",
      "/api/activity?container=homeassistant",
      "/api/activity?unit=ssh.service",
      "/api/activity?backupPath=%2Fvar%2Flog%2Frpi5-backup.log",
      "/api/activity?messageId=7ad2d189f7e94e70a38c781354912448",
    ]) {
      const rejected = await app.inject({ method: "GET", url });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.headers["cache-control"]).toBe("no-store");
      expect(rejected.json()).toEqual({ error: "INVALID_REQUEST" });
    }
  });

  it("normalizes complete source failure without leaking internal details", async () => {
    const app = buildApp({
      activityReader: async () => {
        throw new Error("private socket detail");
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/activity" });
    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });
  });
});
