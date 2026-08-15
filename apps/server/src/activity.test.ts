import type { DockerRecentEventsSnapshot } from "@dashboard-rpi5/contracts";
import type { BackupEvidenceSnapshot } from "@dashboard-rpi5/contracts/backups";
import type { SystemdServicesSnapshot } from "@dashboard-rpi5/contracts/services";
import { describe, expect, it } from "vitest";

import {
  ActivitySourceUnavailableError,
  createActivityReader,
  normalizeBackupActivity,
  normalizeDockerActivity,
  normalizeSystemdActivity,
} from "./activity.js";

const containerId = "a".repeat(64);

const dockerSnapshot: DockerRecentEventsSnapshot = {
  observedAt: "2026-08-15T17:00:00.000Z",
  windowStart: "2026-08-15T16:00:00.000Z",
  windowEnd: "2026-08-15T17:00:00.000Z",
  apiVersion: "1.40",
  events: [
    {
      occurredAt: "2026-08-15T16:59:58.000Z",
      action: "RESTART",
      containerId,
      containerName: "homeassistant",
      image: "homeassistant/home-assistant:stable",
      health: null,
      exitCode: null,
      signal: null,
      scope: "LOCAL",
    },
    {
      occurredAt: "2026-08-15T16:59:56.000Z",
      action: "RESTART",
      containerId,
      containerName: "homeassistant",
      image: "homeassistant/home-assistant:stable",
      health: null,
      exitCode: null,
      signal: null,
      scope: "LOCAL",
    },
    {
      occurredAt: "2026-08-15T16:58:00.000Z",
      action: "OOM",
      containerId,
      containerName: "homeassistant",
      image: null,
      health: null,
      exitCode: null,
      signal: null,
      scope: "LOCAL",
    },
  ],
};

const servicesSnapshot: SystemdServicesSnapshot = {
  observedAt: "2026-08-15T17:00:00.000Z",
  services: [
    {
      unitId: "docker.service",
      label: "Docker Engine",
      loadState: "LOADED",
      activeState: "ACTIVE",
      subState: "running",
      enablement: "ENABLED",
      restartCount: 0,
      stateAgeSeconds: 30,
    },
    {
      unitId: "ssh.service",
      label: "SSH",
      loadState: "LOADED",
      activeState: "FAILED",
      subState: "failed",
      enablement: "ENABLED",
      restartCount: 1,
      stateAgeSeconds: 90,
    },
    {
      unitId: "cron.service",
      label: "Cron",
      loadState: "LOADED",
      activeState: "ACTIVE",
      subState: "running",
      enablement: "ENABLED",
      restartCount: 0,
      stateAgeSeconds: null,
    },
  ],
};

const backupSnapshot: BackupEvidenceSnapshot = {
  observedAt: "2026-08-15T17:00:00.000Z",
  schema: "dashboard-rpi5.backup-evidence.v1",
  runs: [
    {
      runId: "backup-success",
      startedAt: "2026-08-15T16:57:45.000Z",
      completedAt: "2026-08-15T16:59:45.000Z",
      result: "SUCCESS",
      durationSeconds: 120,
      sizeBytes: 123_456_789,
      exitCode: 0,
    },
    {
      runId: "backup-failed",
      startedAt: "2026-08-15T16:56:00.000Z",
      completedAt: "2026-08-15T16:57:00.000Z",
      result: "FAILED",
      durationSeconds: 60,
      sizeBytes: null,
      exitCode: 23,
    },
  ],
};

describe("Phase 5C-B activity normalization", () => {
  it("groups only matching Docker bursts and maps deterministic severity", () => {
    const items = normalizeDockerActivity(dockerSnapshot);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: "DOCKER",
      kind: "DOCKER_RESTART",
      severity: "ATTENTION",
      groupCount: 2,
      target: "/docker",
    });
    expect(items[1]).toMatchObject({
      kind: "DOCKER_OOM",
      severity: "CRITICAL",
      groupCount: 1,
    });
  });

  it("keeps distinct normalized Docker evidence even when timestamps share one millisecond", () => {
    const base = {
      occurredAt: "2026-08-15T16:59:59.123Z",
      action: "KILL" as const,
      containerId,
      containerName: "homeassistant",
      image: "homeassistant/home-assistant:stable",
      health: null,
      exitCode: null,
      scope: "LOCAL" as const,
    };
    const snapshot: DockerRecentEventsSnapshot = {
      observedAt: "2026-08-15T17:00:00.000Z",
      windowStart: "2026-08-15T16:00:00.000Z",
      windowEnd: "2026-08-15T17:00:00.000Z",
      apiVersion: "1.40",
      events: [
        { ...base, signal: "SIGTERM" },
        { ...base, signal: "SIGKILL" },
      ],
    };

    const items = normalizeDockerActivity(snapshot);
    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
    expect(items.map((item) => item.detail).sort()).toEqual([
      "signal SIGKILL · image homeassistant/home-assistant:stable · scope local",
      "signal SIGTERM · image homeassistant/home-assistant:stable · scope local",
    ]);
  });

  it("derives service transition timestamps only from validated observedAt and stateAgeSeconds", () => {
    const items = normalizeSystemdActivity(servicesSnapshot);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: "SYSTEMD",
      severity: "INFO",
      occurredAt: "2026-08-15T16:59:30.000Z",
      target: "/services",
    });
    expect(items[1]).toMatchObject({
      severity: "CRITICAL",
      occurredAt: "2026-08-15T16:58:30.000Z",
    });
  });

  it("maps only structured backup runs into stable result events", () => {
    const items = normalizeBackupActivity(backupSnapshot);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: "BACKUP",
      severity: "INFO",
      kind: "BACKUP_RESULT",
      occurredAt: "2026-08-15T16:59:45.000Z",
      title: "Backup completed",
      target: "/backups",
      groupCount: 1,
    });
    expect(items[0]?.detail).toBe(
      "run backup-success · duration 120s · size 123456789 bytes · exit 0",
    );
    expect(items[1]).toMatchObject({
      severity: "CRITICAL",
      title: "Backup failed",
      detail: "run backup-failed · duration 60s · size unavailable · exit 23",
    });
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
  });

  it("returns a newest-first timeline with explicit partial-source degradation", async () => {
    const reader = createActivityReader({
      dockerEventsReader: async () => {
        throw new Error("private Docker detail");
      },
      servicesReader: async () => servicesSnapshot,
      backupEvidenceReader: async () => backupSnapshot,
      now: () => new Date("2026-08-15T17:00:05.000Z"),
    });

    const snapshot = await reader();
    expect(snapshot).toMatchObject({
      observedAt: "2026-08-15T17:00:05.000Z",
      sources: [
        { source: "DOCKER", status: "UNAVAILABLE", observedAt: null },
        { source: "SYSTEMD", status: "AVAILABLE", observedAt: servicesSnapshot.observedAt },
        { source: "BACKUP", status: "AVAILABLE", observedAt: backupSnapshot.observedAt },
      ],
    });
    expect(snapshot.items.map((item) => item.occurredAt)).toEqual([
      "2026-08-15T16:59:45.000Z",
      "2026-08-15T16:59:30.000Z",
      "2026-08-15T16:58:30.000Z",
      "2026-08-15T16:57:00.000Z",
    ]);
  });

  it("keeps a missing backup producer explicit while valid Docker and service evidence remains usable", async () => {
    const reader = createActivityReader({
      dockerEventsReader: async () => dockerSnapshot,
      servicesReader: async () => servicesSnapshot,
      backupEvidenceReader: async () => {
        throw new Error("structured producer not activated");
      },
    });
    const snapshot = await reader();
    expect(snapshot.sources[2]).toEqual({ source: "BACKUP", status: "UNAVAILABLE", observedAt: null });
    expect(snapshot.items.some((item) => item.source === "BACKUP")).toBe(false);
    expect(snapshot.items.some((item) => item.source === "DOCKER")).toBe(true);
    expect(snapshot.items.some((item) => item.source === "SYSTEMD")).toBe(true);
  });

  it("fails closed only when every authoritative source is unavailable", async () => {
    const reader = createActivityReader({
      dockerEventsReader: async () => {
        throw new Error("private Docker detail");
      },
      servicesReader: async () => {
        throw new Error("private systemd detail");
      },
      backupEvidenceReader: async () => {
        throw new Error("private backup detail");
      },
    });
    await expect(reader()).rejects.toBeInstanceOf(ActivitySourceUnavailableError);
  });
});
