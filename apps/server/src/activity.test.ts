import type { DockerRecentEventsSnapshot } from "@dashboard-rpi5/contracts";
import type { BackupEvidenceSnapshot } from "@dashboard-rpi5/contracts/backups";
import type { DeployEventsSnapshot } from "@dashboard-rpi5/contracts/deploy";
import type { MaintenanceEventsSnapshot } from "@dashboard-rpi5/contracts/maintenance";
import type { SystemdServicesSnapshot } from "@dashboard-rpi5/contracts/services";
import { describe, expect, it } from "vitest";

import {
  ActivitySourceUnavailableError,
  createActivityReader,
  normalizeBackupActivity,
  normalizeDeployActivity,
  normalizeDockerActivity,
  normalizeMaintenanceActivity,
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

const maintenanceSnapshot: MaintenanceEventsSnapshot = {
  observedAt: "2026-08-15T17:00:01.000Z",
  events: [
    {
      invocationId: "0123456789abcdef0123456789abcdef",
      occurredAt: "2026-08-15T16:59:50.000Z",
      result: "SUCCESS",
      unitResult: null,
    },
    {
      invocationId: "fedcba9876543210fedcba9876543210",
      occurredAt: "2026-08-15T16:58:45.000Z",
      result: "FAILED",
      unitResult: "exit-code",
    },
  ],
};

const deploySnapshot: DeployEventsSnapshot = {
  observedAt: "2026-08-15T17:00:02.000Z",
  events: [
    {
      transactionId: "20260815T165955000000Z-abcdef123456",
      commit: "abcdef123456",
      occurredAt: "2026-08-15T16:59:55.000Z",
    },
  ],
};

describe("Phase 5C-D activity normalization", () => {
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
    expect(items[1]).toMatchObject({ kind: "DOCKER_OOM", severity: "CRITICAL", groupCount: 1 });
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
    expect(items[1]).toMatchObject({ severity: "CRITICAL", occurredAt: "2026-08-15T16:58:30.000Z" });
  });

  it("maps only structured backup runs into stable result events", () => {
    const items = normalizeBackupActivity(backupSnapshot);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: "BACKUP",
      severity: "INFO",
      kind: "BACKUP_RESULT",
      title: "Backup completed",
      target: "/backups",
    });
    expect(items[1]).toMatchObject({ severity: "CRITICAL", title: "Backup failed" });
  });

  it("maps only structured systemd-manager maintenance results", () => {
    const items = normalizeMaintenanceActivity(maintenanceSnapshot);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: "MAINTENANCE",
      severity: "INFO",
      kind: "MAINTENANCE_RESULT",
      title: "Maintenance completed",
      target: "/logs",
    });
    expect(items[1]).toMatchObject({ severity: "CRITICAL", title: "Maintenance failed" });
  });

  it("maps only verified successful deploy evidence", () => {
    const items = normalizeDeployActivity(deploySnapshot);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: "DEPLOY",
      severity: "INFO",
      kind: "DEPLOY_VERIFIED",
      occurredAt: "2026-08-15T16:59:55.000Z",
      title: "Deploy verified",
      detail: "commit abcdef123456 · transaction 20260815T165955000000Z-abcdef123456",
      target: "/logs",
      groupCount: 1,
    });
  });

  it("returns a newest-first timeline with explicit five-source degradation", async () => {
    const reader = createActivityReader({
      dockerEventsReader: async () => {
        throw new Error("private Docker detail");
      },
      servicesReader: async () => servicesSnapshot,
      backupEvidenceReader: async () => backupSnapshot,
      maintenanceEventsReader: async () => maintenanceSnapshot,
      deployEventsReader: async () => deploySnapshot,
      now: () => new Date("2026-08-15T17:00:05.000Z"),
    });

    const snapshot = await reader();
    expect(snapshot.sources).toEqual([
      { source: "DOCKER", status: "UNAVAILABLE", observedAt: null },
      { source: "SYSTEMD", status: "AVAILABLE", observedAt: servicesSnapshot.observedAt },
      { source: "BACKUP", status: "AVAILABLE", observedAt: backupSnapshot.observedAt },
      { source: "MAINTENANCE", status: "AVAILABLE", observedAt: maintenanceSnapshot.observedAt },
      { source: "DEPLOY", status: "AVAILABLE", observedAt: deploySnapshot.observedAt },
    ]);
    expect(snapshot.items[0]).toMatchObject({ source: "DEPLOY", occurredAt: "2026-08-15T16:59:55.000Z" });
  });

  it("keeps deploy source failure explicit while other evidence remains usable", async () => {
    const reader = createActivityReader({
      dockerEventsReader: async () => dockerSnapshot,
      servicesReader: async () => servicesSnapshot,
      backupEvidenceReader: async () => backupSnapshot,
      maintenanceEventsReader: async () => maintenanceSnapshot,
      deployEventsReader: async () => {
        throw new Error("journal permission unavailable");
      },
    });
    const snapshot = await reader();
    expect(snapshot.sources[4]).toEqual({ source: "DEPLOY", status: "UNAVAILABLE", observedAt: null });
    expect(snapshot.items.some((item) => item.source === "DEPLOY")).toBe(false);
    expect(snapshot.items.some((item) => item.source === "MAINTENANCE")).toBe(true);
  });

  it("fails closed only when every authoritative source is unavailable", async () => {
    const fail = async () => {
      throw new Error("private detail");
    };
    const reader = createActivityReader({
      dockerEventsReader: fail,
      servicesReader: fail,
      backupEvidenceReader: fail,
      maintenanceEventsReader: fail,
      deployEventsReader: fail,
    });
    await expect(reader()).rejects.toBeInstanceOf(ActivitySourceUnavailableError);
  });
});
