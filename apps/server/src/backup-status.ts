import {
  BACKUP_STATUS_FRESHNESS_BUDGET_SECONDS,
  BACKUP_STATUS_POLICY,
  parseBackupStatusSnapshot,
  type BackupFreshness,
  type BackupHealthState,
  type BackupStatusSnapshot,
} from "@dashboard-rpi5/contracts/backup-status";

import type { BackupEvidenceReader } from "./agent-backup-evidence-client.js";

export type BackupStatusReader = () => Promise<BackupStatusSnapshot>;

interface BackupStatusReaderOptions {
  backupEvidenceReader: BackupEvidenceReader;
  now?: () => Date;
}

export class BackupStatusSourceUnavailableError extends Error {
  constructor() {
    super("Backup status source unavailable");
    this.name = "BackupStatusSourceUnavailableError";
  }
}

export function createBackupStatusReader(
  options: BackupStatusReaderOptions,
): BackupStatusReader {
  const now = options.now ?? (() => new Date());

  return async () => {
    try {
      const evidence = await options.backupEvidenceReader();
      const observedDate = now();
      if (!Number.isFinite(observedDate.getTime())) {
        throw new BackupStatusSourceUnavailableError();
      }
      const observedAt = observedDate.toISOString();
      const observedMs = observedDate.getTime();

      if (evidence.runs.some((run) => Date.parse(run.completedAt) > observedMs)) {
        throw new BackupStatusSourceUnavailableError();
      }

      const latestRun = evidence.runs[0] ?? null;
      const lastSuccess = evidence.runs.find((run) => run.result === "SUCCESS") ?? null;
      const ageSeconds =
        lastSuccess === null
          ? null
          : Math.floor((observedMs - Date.parse(lastSuccess.completedAt)) / 1_000);

      let freshness: BackupFreshness = "UNKNOWN";
      if (ageSeconds !== null) {
        freshness =
          ageSeconds <= BACKUP_STATUS_FRESHNESS_BUDGET_SECONDS ? "FRESH" : "STALE";
      }

      let health: BackupHealthState = "UNKNOWN";
      if (latestRun !== null) {
        if (latestRun.result === "FAILED" || freshness === "STALE") {
          health = "ATTENTION";
        } else if (latestRun.result === "SUCCESS" && freshness === "FRESH") {
          health = "HEALTHY";
        }
      }

      return parseBackupStatusSnapshot({
        observedAt,
        health,
        freshness,
        latestRun,
        lastSuccessfulAt: lastSuccess?.completedAt ?? null,
        ageSeconds,
        policy: BACKUP_STATUS_POLICY,
        history: evidence.runs,
      });
    } catch (error) {
      if (error instanceof BackupStatusSourceUnavailableError) throw error;
      throw new BackupStatusSourceUnavailableError();
    }
  };
}
