import { Static, Type } from "@sinclair/typebox";

export const ActivitySourceSchema = Type.Union([
  Type.Literal("DOCKER"),
  Type.Literal("SYSTEMD"),
  Type.Literal("BACKUP"),
  Type.Literal("MAINTENANCE"),
]);
export type ActivitySource = Static<typeof ActivitySourceSchema>;

export const ActivitySeveritySchema = Type.Union([
  Type.Literal("INFO"),
  Type.Literal("ATTENTION"),
  Type.Literal("CRITICAL"),
]);
export type ActivitySeverity = Static<typeof ActivitySeveritySchema>;

export const ActivityEventKindSchema = Type.Union([
  Type.Literal("DOCKER_CREATE"),
  Type.Literal("DOCKER_DESTROY"),
  Type.Literal("DOCKER_DIE"),
  Type.Literal("DOCKER_HEALTH_STATUS"),
  Type.Literal("DOCKER_KILL"),
  Type.Literal("DOCKER_OOM"),
  Type.Literal("DOCKER_PAUSE"),
  Type.Literal("DOCKER_RENAME"),
  Type.Literal("DOCKER_RESTART"),
  Type.Literal("DOCKER_START"),
  Type.Literal("DOCKER_STOP"),
  Type.Literal("DOCKER_UNPAUSE"),
  Type.Literal("DOCKER_UPDATE"),
  Type.Literal("SYSTEMD_STATE"),
  Type.Literal("BACKUP_RESULT"),
  Type.Literal("MAINTENANCE_RESULT"),
]);
export type ActivityEventKind = Static<typeof ActivityEventKindSchema>;

export const ActivityTargetSchema = Type.Union([
  Type.Literal("/docker"),
  Type.Literal("/services"),
  Type.Literal("/backups"),
  Type.Literal("/logs"),
]);
export type ActivityTarget = Static<typeof ActivityTargetSchema>;

export const ActivitySourceStatusSchema = Type.Union([
  Type.Literal("AVAILABLE"),
  Type.Literal("UNAVAILABLE"),
]);
export type ActivitySourceStatus = Static<typeof ActivitySourceStatusSchema>;

export const ActivitySourceStateSchema = Type.Object(
  {
    source: ActivitySourceSchema,
    status: ActivitySourceStatusSchema,
    observedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ActivitySourceState = Static<typeof ActivitySourceStateSchema>;

export const ActivityItemSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    source: ActivitySourceSchema,
    severity: ActivitySeveritySchema,
    kind: ActivityEventKindSchema,
    occurredAt: Type.String({ format: "date-time" }),
    title: Type.String({ minLength: 1, maxLength: 160 }),
    detail: Type.String({ minLength: 1, maxLength: 320 }),
    target: ActivityTargetSchema,
    groupCount: Type.Integer({ minimum: 1, maximum: 256 }),
  },
  { additionalProperties: false },
);
export type ActivityItem = Static<typeof ActivityItemSchema>;

export const ActivitySnapshotSchema = Type.Object(
  {
    observedAt: Type.String({ format: "date-time" }),
    sources: Type.Array(ActivitySourceStateSchema, { minItems: 4, maxItems: 4 }),
    items: Type.Array(ActivityItemSchema, { maxItems: 256 }),
  },
  { additionalProperties: false },
);
export type ActivitySnapshot = Static<typeof ActivitySnapshotSchema>;

export const ActivityQuerySchema = Type.Object({}, { additionalProperties: false });
export type ActivityQuery = Static<typeof ActivityQuerySchema>;

export const ActivityApiErrorSchema = Type.Object(
  {
    error: Type.Union([
      Type.Literal("INVALID_REQUEST"),
      Type.Literal("SOURCE_UNAVAILABLE"),
    ]),
  },
  { additionalProperties: false },
);
export type ActivityApiError = Static<typeof ActivityApiErrorSchema>;

const SOURCES = new Set<ActivitySource>(["DOCKER", "SYSTEMD", "BACKUP", "MAINTENANCE"]);
const SOURCE_STATUSES = new Set<ActivitySourceStatus>(["AVAILABLE", "UNAVAILABLE"]);
const SEVERITIES = new Set<ActivitySeverity>(["INFO", "ATTENTION", "CRITICAL"]);
const KINDS = new Set<ActivityEventKind>([
  "DOCKER_CREATE",
  "DOCKER_DESTROY",
  "DOCKER_DIE",
  "DOCKER_HEALTH_STATUS",
  "DOCKER_KILL",
  "DOCKER_OOM",
  "DOCKER_PAUSE",
  "DOCKER_RENAME",
  "DOCKER_RESTART",
  "DOCKER_START",
  "DOCKER_STOP",
  "DOCKER_UNPAUSE",
  "DOCKER_UPDATE",
  "SYSTEMD_STATE",
  "BACKUP_RESULT",
  "MAINTENANCE_RESULT",
]);
const TARGETS = new Set<ActivityTarget>(["/docker", "/services", "/backups", "/logs"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseSourceState(value: unknown): ActivitySourceState {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["source", "status", "observedAt"]) ||
    typeof value.source !== "string" ||
    !SOURCES.has(value.source as ActivitySource) ||
    typeof value.status !== "string" ||
    !SOURCE_STATUSES.has(value.status as ActivitySourceStatus) ||
    (value.observedAt !== null && !isIsoDate(value.observedAt))
  ) {
    throw new Error("Invalid activity response");
  }

  return {
    source: value.source as ActivitySource,
    status: value.status as ActivitySourceStatus,
    observedAt: value.observedAt as string | null,
  };
}

function parseItem(value: unknown): ActivityItem {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "id",
      "source",
      "severity",
      "kind",
      "occurredAt",
      "title",
      "detail",
      "target",
      "groupCount",
    ]) ||
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 256 ||
    typeof value.source !== "string" ||
    !SOURCES.has(value.source as ActivitySource) ||
    typeof value.severity !== "string" ||
    !SEVERITIES.has(value.severity as ActivitySeverity) ||
    typeof value.kind !== "string" ||
    !KINDS.has(value.kind as ActivityEventKind) ||
    !isIsoDate(value.occurredAt) ||
    typeof value.title !== "string" ||
    value.title.length < 1 ||
    value.title.length > 160 ||
    typeof value.detail !== "string" ||
    value.detail.length < 1 ||
    value.detail.length > 320 ||
    typeof value.target !== "string" ||
    !TARGETS.has(value.target as ActivityTarget) ||
    typeof value.groupCount !== "number" ||
    !Number.isSafeInteger(value.groupCount) ||
    value.groupCount < 1 ||
    value.groupCount > 256
  ) {
    throw new Error("Invalid activity response");
  }

  return {
    id: value.id,
    source: value.source as ActivitySource,
    severity: value.severity as ActivitySeverity,
    kind: value.kind as ActivityEventKind,
    occurredAt: value.occurredAt,
    title: value.title,
    detail: value.detail,
    target: value.target as ActivityTarget,
    groupCount: value.groupCount,
  };
}

export function parseActivitySnapshot(value: unknown): ActivitySnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["observedAt", "sources", "items"]) ||
    !isIsoDate(value.observedAt) ||
    !Array.isArray(value.sources) ||
    value.sources.length !== 4 ||
    !Array.isArray(value.items) ||
    value.items.length > 256
  ) {
    throw new Error("Invalid activity response");
  }

  const sources = value.sources.map(parseSourceState);
  if (
    new Set(sources.map((source) => source.source)).size !== 4 ||
    !sources.some((source) => source.source === "DOCKER") ||
    !sources.some((source) => source.source === "SYSTEMD") ||
    !sources.some((source) => source.source === "BACKUP") ||
    !sources.some((source) => source.source === "MAINTENANCE")
  ) {
    throw new Error("Invalid activity response");
  }

  const items = value.items.map(parseItem);
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("Invalid activity response");
  }

  for (let index = 1; index < items.length; index += 1) {
    if (Date.parse(items[index - 1]!.occurredAt) < Date.parse(items[index]!.occurredAt)) {
      throw new Error("Invalid activity response");
    }
  }

  return { observedAt: value.observedAt, sources, items };
}
