import { BACKUP_STATUS_POLICY } from "@dashboard-rpi5/contracts/backup-status";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const apps: ReturnType<typeof buildApp>[] = [];

const latestRun = {
  runId: "backup-success",
  startedAt: "2026-08-15T00:00:00.000Z",
  completedAt: "2026-08-15T00:02:00.000Z",
  result: "SUCCESS" as const,
  durationSeconds: 120,
  sizeBytes: 123_456,
  exitCode: 0,
};

const snapshot = {
  observedAt: "2026-08-15T02:00:00.000Z",
  health: "HEALTHY" as const,
  freshness: "FRESH" as const,
  latestRun,
  lastSuccessfulAt: latestRun.completedAt,
  ageSeconds: 7_080,
  policy: BACKUP_STATUS_POLICY,
  history: [latestRun],
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Phase 6A backup status API", () => {
  it("returns only normalized no-store backup state", async () => {
    const app = buildApp({ backupStatusReader: async () => snapshot });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/backups" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual(snapshot);

    for (const forbidden of [
      "/opt/backups",
      "gdrive:",
      "rclone",
      "age.key",
      "age-recipient",
      "/etc/",
    ]) {
      expect(response.body).not.toContain(forbidden);
    }
  });

  it("rejects every browser selector instead of forwarding paths or policy", async () => {
    const app = buildApp({ backupStatusReader: async () => snapshot });
    apps.push(app);

    for (const url of [
      "/api/backups?path=%2Fetc%2Fshadow",
      "/api/backups?source=file%3Arpi5-backup",
      "/api/backups?schedule=hourly",
      "/api/backups?retention=999",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(400);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toEqual({ error: "INVALID_REQUEST" });
    }
  });

  it("normalizes source failure without leaking internal details", async () => {
    const app = buildApp({
      backupStatusReader: async () => {
        throw new Error("private socket / secret path detail");
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/backups" });
    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });
    expect(response.body).not.toContain("private");
    expect(response.body).not.toContain("secret");
  });
});
