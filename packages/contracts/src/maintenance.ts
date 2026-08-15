import { Static, Type } from "@sinclair/typebox";

export const MAINTENANCE_MAX_EVENTS = 64;

export const MaintenanceResultSchema = Type.Union([
  Type.Literal("SUCCESS"),
  Type.Literal("FAILED"),
]);
export type MaintenanceResult = Static<typeof MaintenanceResultSchema>;

export const MaintenanceEventSchema = Type.Object(
  {
    invocationId: Type.String({ pattern: "^[0-9a-f]{32}$" }),
    occurredAt: Type.String({ format: "date-time" }),
    result: MaintenanceResultSchema,
    unitResult: Type.Union([
      Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9._:-]+$" }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export type MaintenanceEvent = Static<typeof MaintenanceEventSchema>;

export const MaintenanceEventsSnapshotSchema = Type.Object(
  {
    observedAt: Type.String({ format: "date-time" }),
    events: Type.Array(MaintenanceEventSchema, { maxItems: MAINTENANCE_MAX_EVENTS }),
  },
  { additionalProperties: false },
);
export type MaintenanceEventsSnapshot = Static<typeof MaintenanceEventsSnapshotSchema>;

export const MaintenanceEventsQuerySchema = Type.Object({}, { additionalProperties: false });
export type MaintenanceEventsQuery = Static<typeof MaintenanceEventsQuerySchema>;

const INVOCATION_ID_PATTERN = /^[0-9a-f]{32}$/;
const UNIT_RESULT_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function parseEvent(value: unknown): MaintenanceEvent {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["invocationId", "occurredAt", "result", "unitResult"]) ||
    typeof value.invocationId !== "string" ||
    !INVOCATION_ID_PATTERN.test(value.invocationId) ||
    !isCanonicalIso(value.occurredAt) ||
    (value.result !== "SUCCESS" && value.result !== "FAILED") ||
    (value.unitResult !== null &&
      (typeof value.unitResult !== "string" || !UNIT_RESULT_PATTERN.test(value.unitResult)))
  ) {
    throw new Error("Invalid maintenance evidence");
  }

  if (
    (value.result === "SUCCESS" && value.unitResult !== null) ||
    (value.result === "FAILED" && value.unitResult === null)
  ) {
    throw new Error("Invalid maintenance evidence");
  }

  return {
    invocationId: value.invocationId,
    occurredAt: value.occurredAt,
    result: value.result,
    unitResult: value.unitResult,
  };
}

export function parseMaintenanceEventsSnapshot(value: unknown): MaintenanceEventsSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["observedAt", "events"]) ||
    !isCanonicalIso(value.observedAt) ||
    !Array.isArray(value.events) ||
    value.events.length > MAINTENANCE_MAX_EVENTS
  ) {
    throw new Error("Invalid maintenance evidence");
  }

  const events = value.events.map(parseEvent);
  const identities = events.map(
    (event) => `${event.invocationId}:${event.occurredAt}:${event.result}:${event.unitResult ?? "none"}`,
  );
  if (new Set(identities).size !== events.length) {
    throw new Error("Invalid maintenance evidence");
  }

  for (let index = 1; index < events.length; index += 1) {
    if (Date.parse(events[index - 1]!.occurredAt) < Date.parse(events[index]!.occurredAt)) {
      throw new Error("Invalid maintenance evidence");
    }
  }

  return { observedAt: value.observedAt, events };
}
