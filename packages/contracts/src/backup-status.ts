import { Static, Type } from "@sinclair/typebox";

import {
  BACKUP_EVIDENCE_MAX_RUNS,
  BACKUP_EVIDENCE_SCHEMA_VERSION,
  BackupEvidenceRunSchema,
  parseBackupEvidenceSnapshot,
  type BackupEvidenceRun,
} from "./backups.js";

export const BACKUP_STATUS_DESTINATION_LABEL = "Encrypted Google Drive" as const;
export const BACKUP_STATUS_SCHEDULE_LABEL = "Daily at 02:00 host local time" as const;
export const BACKUP_STATUS_LOCAL_RETENTION_DAYS = 7 as const;
export const BACKUP_STATUS_REMOTE_RETENTION_DAYS = 30 as const;
export const BACKUP_STATUS_FRESHNESS_BUDGET_HOURS = 30 as const;
export const BACKUP_STATUS_FRESHNESS_BUDGET_SECONDS =
  BACKUP_STATUS_FRESHNESS_BUDGET_HOURS * 60 * 60;

export const BackupHealthStateSchema = Type.Union([
  Type.Literal("HEALTHY"),
  Type.Literal("ATTENTION"),
  Type.Literal("UNKNOWN"),
]);
export type BackupHealthState = Static<typeof BackupHealthStateSchema>;

export const BackupFreshnessSchema = Type.Union([
  Type.Literal("FRESH"),
  Type.Literal("STALE"),
  Type.Literal("UNKNOWN"),
]);
export type BackupFreshness = Static<typeof BackupFreshnessSchema>;

export const BackupPolicySchema = Type.Object(
  {
    destinationLabel: Type.Literal(BACKUP_STATUS_DESTINATION_LABEL),
    scheduleLabel: Type.Literal(BACKUP_STATUS_SCHEDULE_LABEL),
    localRetentionDays: Type.Literal(BACKUP_STATUS_LOCAL_RETENTION_DAYS),
    remoteRetentionDays: Type.Literal(BACKUP_STATUS_REMOTE_RETENTION_DAYS),
    freshnessBudgetHours: Type.Literal(BACKUP_STATUS_FRESHNESS_BUDGET_HOURS),
  },
  { additionalProperties: false },
);
export type BackupPolicy = Static<typeof BackupPolicySchema>;

export const BackupStatusSnapshotSchema = Type.Object(
  {
    observedAt: Type.String({ format: "date-time" }),
    health: BackupHealthStateSchema,
    freshness: BackupFreshnessSchema,
    latestRun: Type.Union([BackupEvidenceRunSchema, Type.Null()]),
    lastSuccessfulAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    ageSeconds: Type.Union([
      Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      Type.Null(),
    ]),
    policy: BackupPolicySchema,
    history: Type.Array(BackupEvidenceRunSchema, { maxItems: BACKUP_EVIDENCE_MAX_RUNS }),
  },
  { additionalProperties: false },
);
export type BackupStatusSnapshot = Static<typeof BackupStatusSnapshotSchema>;

export const BackupStatusQuerySchema = Type.Object({}, { additionalProperties: false });
export const BackupStatusApiErrorSchema = Type.Object(
  { error: Type.Union([Type.Literal("INVALID_REQUEST"), Type.Literal("SOURCE_UNAVAILABLE")]) },
  { additionalProperties: false },
);

export const BACKUP_STATUS_POLICY: BackupPolicy = {
  destinationLabel: BACKUP_STATUS_DESTINATION_LABEL,
  scheduleLabel: BACKUP_STATUS_SCHEDULE_LABEL,
  localRetentionDays: BACKUP_STATUS_LOCAL_RETENTION_DAYS,
  remoteRetentionDays: BACKUP_STATUS_REMOTE_RETENTION_DAYS,
  freshnessBudgetHours: BACKUP_STATUS_FRESHNESS_BUDGET_HOURS,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function sameRun(left: BackupEvidenceRun | null, right: BackupEvidenceRun | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expectedHealth(
  latestRun: BackupEvidenceRun | null,
  freshness: BackupFreshness,
): BackupHealthState {
  if (latestRun === null) return "UNKNOWN";
  if (latestRun.result === "FAILED") return "ATTENTION";
  if (freshness === "STALE") return "ATTENTION";
  if (freshness === "FRESH") return "HEALTHY";
  return "UNKNOWN";
}

export function parseBackupStatusSnapshot(value: unknown): BackupStatusSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "observedAt",
      "health",
      "freshness",
      "latestRun",
      "lastSuccessfulAt",
      "ageSeconds",
      "policy",
      "history",
    ]) ||
    !isCanonicalTimestamp(value.observedAt) ||
    !["HEALTHY", "ATTENTION", "UNKNOWN"].includes(String(value.health)) ||
    !["FRESH", "STALE", "UNKNOWN"].includes(String(value.freshness)) ||
    !isRecord(value.policy) ||
    JSON.stringify(value.policy) !== JSON.stringify(BACKUP_STATUS_POLICY) ||
    !Array.isArray(value.history)
  ) {
    throw new Error("Invalid backup status");
  }

  const evidence = parseBackupEvidenceSnapshot({
    observedAt: value.observedAt,
    schema: BACKUP_EVIDENCE_SCHEMA_VERSION,
    runs: value.history,
  });
  const latestRun = evidence.runs[0] ?? null;

  if (value.latestRun !== null && !isRecord(value.latestRun)) {
    throw new Error("Invalid backup status");
  }
  const parsedLatest =
    value.latestRun === null
      ? null
      : parseBackupEvidenceSnapshot({
          observedAt: value.observedAt,
          schema: BACKUP_EVIDENCE_SCHEMA_VERSION,
          runs: [value.latestRun],
        }).runs[0] ?? null;
  if (!sameRun(latestRun, parsedLatest)) throw new Error("Invalid backup status");

  const lastSuccess = evidence.runs.find((run) => run.result === "SUCCESS") ?? null;
  const expectedLastSuccessfulAt = lastSuccess?.completedAt ?? null;
  if (value.lastSuccessfulAt !== expectedLastSuccessfulAt) {
    throw new Error("Invalid backup status");
  }

  let expectedAge: number | null = null;
  let expectedFreshness: BackupFreshness = "UNKNOWN";
  if (lastSuccess !== null) {
    const ageMs = Date.parse(value.observedAt) - Date.parse(lastSuccess.completedAt);
    if (ageMs < 0) throw new Error("Invalid backup status");
    expectedAge = Math.floor(ageMs / 1_000);
    expectedFreshness =
      expectedAge <= BACKUP_STATUS_FRESHNESS_BUDGET_SECONDS ? "FRESH" : "STALE";
  }

  if (value.ageSeconds !== expectedAge || value.freshness !== expectedFreshness) {
    throw new Error("Invalid backup status");
  }
  const health = expectedHealth(latestRun, expectedFreshness);
  if (value.health !== health) throw new Error("Invalid backup status");

  return {
    observedAt: value.observedAt,
    health,
    freshness: expectedFreshness,
    latestRun,
    lastSuccessfulAt: expectedLastSuccessfulAt,
    ageSeconds: expectedAge,
    policy: BACKUP_STATUS_POLICY,
    history: evidence.runs,
  };
}
