import { describe, expect, it } from "vitest";

import {
  BACKUP_STATUS_POLICY,
  parseBackupStatusSnapshot,
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

describe("Phase 6A normalized backup status contract", () => {
  it("accepts a fresh latest successful run as healthy", () => {
    expect(
      parseBackupStatusSnapshot({
        observedAt: "2026-08-15T02:00:00.000Z",
        health: "HEALTHY",
        freshness: "FRESH",
        latestRun: success,
        lastSuccessfulAt: success.completedAt,
        ageSeconds: 7_080,
        policy: BACKUP_STATUS_POLICY,
        history: [success],
      }),
    ).toMatchObject({ health: "HEALTHY", freshness: "FRESH", ageSeconds: 7_080 });
  });

  it("requires a successful run older than 30 hours to be stale and attention", () => {
    const observedAt = "2026-08-16T06:02:01.000Z";
    expect(
      parseBackupStatusSnapshot({
        observedAt,
        health: "ATTENTION",
        freshness: "STALE",
        latestRun: success,
        lastSuccessfulAt: success.completedAt,
        ageSeconds: 108_001,
        policy: BACKUP_STATUS_POLICY,
        history: [success],
      }),
    ).toMatchObject({ health: "ATTENTION", freshness: "STALE" });
  });

  it("keeps latest failure as attention even when a previous success is still fresh", () => {
    expect(
      parseBackupStatusSnapshot({
        observedAt: "2026-08-15T02:00:00.000Z",
        health: "ATTENTION",
        freshness: "FRESH",
        latestRun: failed,
        lastSuccessfulAt: success.completedAt,
        ageSeconds: 7_080,
        policy: BACKUP_STATUS_POLICY,
        history: [failed, success],
      }),
    ).toMatchObject({ health: "ATTENTION", freshness: "FRESH", latestRun: failed });
  });

  it("keeps an empty validated history unknown instead of healthy", () => {
    expect(
      parseBackupStatusSnapshot({
        observedAt: "2026-08-15T02:00:00.000Z",
        health: "UNKNOWN",
        freshness: "UNKNOWN",
        latestRun: null,
        lastSuccessfulAt: null,
        ageSeconds: null,
        policy: BACKUP_STATUS_POLICY,
        history: [],
      }),
    ).toMatchObject({ health: "UNKNOWN", freshness: "UNKNOWN", latestRun: null });
  });

  it("rejects derived-field and policy drift", () => {
    const base = {
      observedAt: "2026-08-15T02:00:00.000Z",
      health: "HEALTHY",
      freshness: "FRESH",
      latestRun: success,
      lastSuccessfulAt: success.completedAt,
      ageSeconds: 7_080,
      policy: BACKUP_STATUS_POLICY,
      history: [success],
    };

    for (const value of [
      { ...base, health: "ATTENTION" },
      { ...base, freshness: "STALE" },
      { ...base, ageSeconds: 1 },
      { ...base, lastSuccessfulAt: null },
      { ...base, latestRun: null },
      { ...base, policy: { ...BACKUP_STATUS_POLICY, localRetentionDays: 8 } },
      { ...base, observedAt: "2026-08-15T02:00:00Z" },
    ]) {
      expect(() => parseBackupStatusSnapshot(value)).toThrow("Invalid backup status");
    }
  });

  it("rejects a future successful completion relative to observedAt", () => {
    expect(() =>
      parseBackupStatusSnapshot({
        observedAt: "2026-08-14T23:59:59.000Z",
        health: "HEALTHY",
        freshness: "FRESH",
        latestRun: success,
        lastSuccessfulAt: success.completedAt,
        ageSeconds: 0,
        policy: BACKUP_STATUS_POLICY,
        history: [success],
      }),
    ).toThrow("Invalid backup status");
  });
});
