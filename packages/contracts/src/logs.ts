import { Static, Type } from "@sinclair/typebox";

export const LogSourceIdSchema = Type.Union([
  Type.Literal("docker:homeassistant"),
  Type.Literal("docker:prometheus"),
  Type.Literal("systemd:docker"),
  Type.Literal("systemd:ssh"),
  Type.Literal("systemd:cron"),
  Type.Literal("systemd:dashboard-rpi5-agent"),
  Type.Literal("systemd:rpi5-update"),
  Type.Literal("file:rpi5-backup"),
]);
export type LogSourceId = Static<typeof LogSourceIdSchema>;

export const LogSourceKindSchema = Type.Union([
  Type.Literal("DOCKER"),
  Type.Literal("SYSTEMD"),
  Type.Literal("FILE"),
]);
export type LogSourceKind = Static<typeof LogSourceKindSchema>;

export const LogRangeSchema = Type.Union([
  Type.Literal("15m"),
  Type.Literal("1h"),
  Type.Literal("6h"),
  Type.Literal("24h"),
]);
export type LogRange = Static<typeof LogRangeSchema>;

export const LogRangeModeSchema = Type.Union([
  Type.Literal("TIME"),
  Type.Literal("TAIL"),
]);
export type LogRangeMode = Static<typeof LogRangeModeSchema>;

export const LogLevelSchema = Type.Union([
  Type.Literal("DEBUG"),
  Type.Literal("INFO"),
  Type.Literal("NOTICE"),
  Type.Literal("WARN"),
  Type.Literal("ERROR"),
  Type.Literal("CRITICAL"),
  Type.Literal("UNKNOWN"),
]);
export type LogLevel = Static<typeof LogLevelSchema>;

export const LogStreamSchema = Type.Union([
  Type.Literal("STDOUT"),
  Type.Literal("STDERR"),
  Type.Literal("COMBINED"),
  Type.Literal("JOURNAL"),
  Type.Literal("FILE"),
]);
export type LogStream = Static<typeof LogStreamSchema>;

export const LogSourceDescriptorSchema = Type.Object(
  {
    sourceId: LogSourceIdSchema,
    label: Type.String({ minLength: 1, maxLength: 80 }),
    kind: LogSourceKindSchema,
    rangeMode: LogRangeModeSchema,
  },
  { additionalProperties: false },
);
export type LogSourceDescriptor = Static<typeof LogSourceDescriptorSchema>;

export const LogSourcesSnapshotSchema = Type.Object(
  {
    observedAt: Type.String({ format: "date-time" }),
    sources: Type.Array(LogSourceDescriptorSchema, { minItems: 1, maxItems: 32 }),
  },
  { additionalProperties: false },
);
export type LogSourcesSnapshot = Static<typeof LogSourcesSnapshotSchema>;

export const LogEntrySchema = Type.Object(
  {
    sequence: Type.Integer({ minimum: 0, maximum: 399 }),
    timestamp: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    level: LogLevelSchema,
    stream: LogStreamSchema,
    message: Type.String({ minLength: 1, maxLength: 8192 }),
  },
  { additionalProperties: false },
);
export type LogEntry = Static<typeof LogEntrySchema>;

export const LogSnapshotSchema = Type.Object(
  {
    observedAt: Type.String({ format: "date-time" }),
    source: LogSourceDescriptorSchema,
    range: LogRangeSchema,
    rangeApplied: Type.Boolean(),
    entries: Type.Array(LogEntrySchema, { maxItems: 400 }),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type LogSnapshot = Static<typeof LogSnapshotSchema>;

export const LogsQuerySchema = Type.Object(
  {
    sourceId: LogSourceIdSchema,
    range: LogRangeSchema,
  },
  { additionalProperties: false },
);
export type LogsQuery = Static<typeof LogsQuerySchema>;

export const LogSourcesQuerySchema = Type.Object({}, { additionalProperties: false });
export type LogSourcesQuery = Static<typeof LogSourcesQuerySchema>;

export const LogsApiErrorSchema = Type.Object(
  {
    error: Type.Union([
      Type.Literal("INVALID_REQUEST"),
      Type.Literal("SOURCE_UNAVAILABLE"),
    ]),
  },
  { additionalProperties: false },
);
export type LogsApiError = Static<typeof LogsApiErrorSchema>;

const SOURCE_IDS = new Set<LogSourceId>([
  "docker:homeassistant",
  "docker:prometheus",
  "systemd:docker",
  "systemd:ssh",
  "systemd:cron",
  "systemd:dashboard-rpi5-agent",
  "systemd:rpi5-update",
  "file:rpi5-backup",
]);
const SOURCE_KINDS = new Set<LogSourceKind>(["DOCKER", "SYSTEMD", "FILE"]);
const RANGE_MODES = new Set<LogRangeMode>(["TIME", "TAIL"]);
const RANGES = new Set<LogRange>(["15m", "1h", "6h", "24h"]);
const LEVELS = new Set<LogLevel>([
  "DEBUG",
  "INFO",
  "NOTICE",
  "WARN",
  "ERROR",
  "CRITICAL",
  "UNKNOWN",
]);
const STREAMS = new Set<LogStream>([
  "STDOUT",
  "STDERR",
  "COMBINED",
  "JOURNAL",
  "FILE",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseDescriptor(value: unknown): LogSourceDescriptor {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["sourceId", "label", "kind", "rangeMode"]) ||
    typeof value.sourceId !== "string" ||
    !SOURCE_IDS.has(value.sourceId as LogSourceId) ||
    typeof value.label !== "string" ||
    value.label.length < 1 ||
    value.label.length > 80 ||
    typeof value.kind !== "string" ||
    !SOURCE_KINDS.has(value.kind as LogSourceKind) ||
    typeof value.rangeMode !== "string" ||
    !RANGE_MODES.has(value.rangeMode as LogRangeMode)
  ) {
    throw new Error("Invalid log source descriptor");
  }

  return {
    sourceId: value.sourceId as LogSourceId,
    label: value.label,
    kind: value.kind as LogSourceKind,
    rangeMode: value.rangeMode as LogRangeMode,
  };
}

function parseEntry(value: unknown, expectedSequence: number): LogEntry {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["sequence", "timestamp", "level", "stream", "message"]) ||
    value.sequence !== expectedSequence ||
    !Number.isSafeInteger(value.sequence) ||
    expectedSequence > 399 ||
    (value.timestamp !== null &&
      (typeof value.timestamp !== "string" || !Number.isFinite(Date.parse(value.timestamp)))) ||
    typeof value.level !== "string" ||
    !LEVELS.has(value.level as LogLevel) ||
    typeof value.stream !== "string" ||
    !STREAMS.has(value.stream as LogStream) ||
    typeof value.message !== "string" ||
    value.message.length < 1 ||
    value.message.length > 8192
  ) {
    throw new Error("Invalid log entry");
  }

  return {
    sequence: expectedSequence,
    timestamp: value.timestamp as string | null,
    level: value.level as LogLevel,
    stream: value.stream as LogStream,
    message: value.message,
  };
}

export function parseLogSourcesSnapshot(value: unknown): LogSourcesSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["observedAt", "sources"]) ||
    typeof value.observedAt !== "string" ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    !Array.isArray(value.sources) ||
    value.sources.length < 1 ||
    value.sources.length > 32
  ) {
    throw new Error("Invalid log sources response");
  }

  const sources = value.sources.map(parseDescriptor);
  if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) {
    throw new Error("Invalid log sources response");
  }

  return { observedAt: value.observedAt, sources };
}

export function parseLogSnapshot(value: unknown): LogSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "observedAt",
      "source",
      "range",
      "rangeApplied",
      "entries",
      "truncated",
    ]) ||
    typeof value.observedAt !== "string" ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    typeof value.range !== "string" ||
    !RANGES.has(value.range as LogRange) ||
    typeof value.rangeApplied !== "boolean" ||
    !Array.isArray(value.entries) ||
    value.entries.length > 400 ||
    typeof value.truncated !== "boolean"
  ) {
    throw new Error("Invalid logs response");
  }

  const source = parseDescriptor(value.source);
  const entries = value.entries.map((entry, index) => parseEntry(entry, index));

  if (source.rangeMode === "TIME" && value.rangeApplied !== true) {
    throw new Error("Invalid logs response");
  }
  if (source.rangeMode === "TAIL" && value.rangeApplied !== false) {
    throw new Error("Invalid logs response");
  }

  return {
    observedAt: value.observedAt,
    source,
    range: value.range as LogRange,
    rangeApplied: value.rangeApplied,
    entries,
    truncated: value.truncated,
  };
}
