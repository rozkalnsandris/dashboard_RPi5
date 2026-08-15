import type { BackupEvidenceSnapshot } from "@dashboard-rpi5/contracts/backups";
import { describe, expect, it } from "vitest";

import {
  BackupStatusSourceUnavailableError,
  createBackupStatusReader,
} from "./backup-status.js";

const success = {
  runId: "backup-success",
  startedAt: "2026-08-15T00:00:00.000Z",
  completedAt: "2026-08-15T00:02:00.000Z",
  result: "SUCCESS" as const,
  durationSeconds: 120,
  sizeBytes: 123_456,
  exitCode: 0,
};

const failed = {
  runId: "backup-failed",
  startedAt: "2026-08-15T01:00:00.000Z",
  completedAt: "2026-08-15T01:01:00.000Z",
  result: "FAILED" as const,
  durationSeconds: 60,
  sizeBytes: null,
  exitCode: 23,
};

function evidence(runs: BackupEvidenceSnapshot["runs"]): BackupEvidenceSnapshot {
  return {
    observedAt: "2026-08-15T01:30:00.000Z",
    schema: "dashboard-rpi5.backup-evidence.v1",
    runs,
  };
}

describe("Phase 6A backup health reader", () => {
  it("derives fresh successful evidence as healthy with reviewed policy only", async () => {
    const reader = createBackupStatusReader({
      backupEvidenceReader: async () => evidence([success]),
      now: () => new Date("2026-08-15T02:00:00.000Z"),
    });

    await expect(reader()).resolves.toMatchObject({
      observedAt: "2026-08-15T02:00:00.000Z",
      health: "HEALTHY",
      freshness: "FRESH",
      ageSeconds: 7_080,
      latestRun: success,
      policy: {
        destinationLabel: "Encrypted Google Drive",
        scheduleLabel: "Daily at 02:00 host local time",
        localRetentionDays: 7,
        remoteRetentionDays: 30,
        freshnessBudgetHours: 30,
      },
    });
  });

  it("treats a successful latest run beyond the 30-hour budget as stale attention", async () => {
    const reader = createBackupStatusReader({
      backupEvidenceReader: async () => evidence([success]),
      now: () => new Date("2026-08-16T06:02:01.000Z"),
    });

    await expect(reader()).resolves.toMatchObject({
      health: "ATTENTION",
      freshness: "STALE",
      ageSeconds: 108_001,
    });
  });

  it("treats latest failure as attention while preserving freshness of prior success", async () => {
    const reader = createBackupStatusReader({
      backupEvidenceReader: async () => evidence([failed, success]),
      now: () => new Date("2026-08-15T02:00:00.000Z"),
    });

    await expect(reader()).resolves.toMatchObject({
      health: "ATTENTION",
      freshness: "FRESH",
      latestRun: failed,
      lastSuccessfulAt: success.completedAt,
    });
  });

  it("keeps a valid empty history unknown", async () => {
    const reader = createBackupStatusReader({
      backupEvidenceReader: async () => evidence([]),
      now: () => new Date("2026-08-15T02:00:00.000Z"),
    });

    await expect(reader()).resolves.toMatchObject({
      health: "UNKNOWN",
      freshness: "UNKNOWN",
      latestRun: null,
      lastSuccessfulAt: null,
      ageSeconds: null,
    });
  });

  it("fails closed for source failure, invalid clock and future producer evidence", async () => {
    const sourceFailure = createBackupStatusReader({
      backupEvidenceReader: async () => {
        throw new Error("private socket detail");
      },
    });
    await expect(sourceFailure()).rejects.toBeInstanceOf(BackupStatusSourceUnavailableError);

    const invalidClock = createBackupStatusReader({
      backupEvidenceReader: async () => evidence([]),
      now: () => new Date(Number.NaN),
    });
    await expect(invalidClock()).rejects.toBeInstanceOf(BackupStatusSourceUnavailableError);

    const futureEvidence = createBackupStatusReader({
      backupEvidenceReader: async () => evidence([failed]),
      now: () => new Date("2026-08-15T00:30:00.000Z"),
    });
    await expect(futureEvidence()).rejects.toBeInstanceOf(BackupStatusSourceUnavailableError);
  });
});
