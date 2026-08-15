import { Static, Type } from "@sinclair/typebox";

export const BACKUP_EVIDENCE_SCHEMA_VERSION = "dashboard-rpi5.backup-evidence.v1" as const;
export const BACKUP_EVIDENCE_MAX_RUNS = 32;

export const BackupResultSchema = Type.Union([
  Type.Literal("SUCCESS"),
  Type.Literal("FAILED"),
]);
export type BackupResult = Static<typeof BackupResultSchema>;

export const BackupEvidenceRunSchema = Type.Object(
  {
    runId: Type.String({ minLength: 1, maxLength: 80, pattern: "^[A-Za-z0-9][A-Za-z0-9._:+-]*$" }),
    startedAt: Type.String({ format: "date-time" }),
    completedAt: Type.String({ format: "date-time" }),
    result: BackupResultSchema,
    durationSeconds: Type.Integer({ minimum: 0, maximum: 172_800 }),
    sizeBytes: Type.Union([
      Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
      Type.Null(),
    ]),
    exitCode: Type.Integer({ minimum: 0, maximum: 255 }),
  },
  { additionalProperties: false },
);
export type BackupEvidenceRun = Static<typeof BackupEvidenceRunSchema>;

export const BackupEvidenceFileSchema = Type.Object(
  {
    schema: Type.Literal(BACKUP_EVIDENCE_SCHEMA_VERSION),
    runs: Type.Array(BackupEvidenceRunSchema, { maxItems: BACKUP_EVIDENCE_MAX_RUNS }),
  },
  { additionalProperties: false },
);
export type BackupEvidenceFile = Static<typeof BackupEvidenceFileSchema>;

export const BackupEvidenceSnapshotSchema = Type.Object(
  {
    observedAt: Type.String({ format: "date-time" }),
    schema: Type.Literal(BACKUP_EVIDENCE_SCHEMA_VERSION),
    runs: Type.Array(BackupEvidenceRunSchema, { maxItems: BACKUP_EVIDENCE_MAX_RUNS }),
  },
  { additionalProperties: false },
);
export type BackupEvidenceSnapshot = Static<typeof BackupEvidenceSnapshotSchema>;

export const BackupEvidenceQuerySchema = Type.Object({}, { additionalProperties: false });
export type BackupEvidenceQuery = Static<typeof BackupEvidenceQuerySchema>;

const RESULTS = new Set<BackupResult>(["SUCCESS", "FAILED"]);
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,79}$/;
const RFC3339_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return new Set([4, 6, 9, 11]).has(month) ? 30 : 31;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = RFC3339_WITH_ZONE.exec(value);
  if (match === null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return false;
  }

  return Number.isFinite(Date.parse(value));
}

function parseRun(value: unknown): BackupEvidenceRun {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "runId",
      "startedAt",
      "completedAt",
      "result",
      "durationSeconds",
      "sizeBytes",
      "exitCode",
    ]) ||
    typeof value.runId !== "string" ||
    !RUN_ID_PATTERN.test(value.runId) ||
    !isTimestamp(value.startedAt) ||
    !isTimestamp(value.completedAt) ||
    typeof value.result !== "string" ||
    !RESULTS.has(value.result as BackupResult) ||
    typeof value.durationSeconds !== "number" ||
    !Number.isSafeInteger(value.durationSeconds) ||
    value.durationSeconds < 0 ||
    value.durationSeconds > 172_800 ||
    (value.sizeBytes !== null &&
      (typeof value.sizeBytes !== "number" ||
        !Number.isSafeInteger(value.sizeBytes) ||
        value.sizeBytes < 1)) ||
    typeof value.exitCode !== "number" ||
    !Number.isSafeInteger(value.exitCode) ||
    value.exitCode < 0 ||
    value.exitCode > 255
  ) {
    throw new Error("Invalid backup evidence");
  }

  const startedMs = Date.parse(value.startedAt);
  const completedMs = Date.parse(value.completedAt);
  if (completedMs < startedMs) {
    throw new Error("Invalid backup evidence");
  }

  const measuredDuration = (completedMs - startedMs) / 1_000;
  if (Math.abs(measuredDuration - value.durationSeconds) > 2) {
    throw new Error("Invalid backup evidence");
  }

  const result = value.result as BackupResult;
  if (
    (result === "SUCCESS" && (value.exitCode !== 0 || value.sizeBytes === null)) ||
    (result === "FAILED" && value.exitCode === 0)
  ) {
    throw new Error("Invalid backup evidence");
  }

  return {
    runId: value.runId,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    result,
    durationSeconds: value.durationSeconds,
    sizeBytes: value.sizeBytes as number | null,
    exitCode: value.exitCode,
  };
}

function parseRuns(value: unknown): BackupEvidenceRun[] {
  if (!Array.isArray(value) || value.length > BACKUP_EVIDENCE_MAX_RUNS) {
    throw new Error("Invalid backup evidence");
  }

  const runs = value.map(parseRun);
  if (new Set(runs.map((run) => run.runId)).size !== runs.length) {
    throw new Error("Invalid backup evidence");
  }

  return [...runs].sort((left, right) => {
    const byTime = Date.parse(right.completedAt) - Date.parse(left.completedAt);
    return byTime !== 0 ? byTime : left.runId.localeCompare(right.runId);
  });
}

export function parseBackupEvidenceFile(value: unknown): BackupEvidenceFile {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["schema", "runs"]) ||
    value.schema !== BACKUP_EVIDENCE_SCHEMA_VERSION
  ) {
    throw new Error("Invalid backup evidence");
  }

  return {
    schema: BACKUP_EVIDENCE_SCHEMA_VERSION,
    runs: parseRuns(value.runs),
  };
}

export function parseBackupEvidenceSnapshot(value: unknown): BackupEvidenceSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["observedAt", "schema", "runs"]) ||
    !isTimestamp(value.observedAt) ||
    value.schema !== BACKUP_EVIDENCE_SCHEMA_VERSION
  ) {
    throw new Error("Invalid backup evidence");
  }

  return {
    observedAt: value.observedAt,
    schema: BACKUP_EVIDENCE_SCHEMA_VERSION,
    runs: parseRuns(value.runs),
  };
}
