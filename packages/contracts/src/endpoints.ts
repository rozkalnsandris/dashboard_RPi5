import { Static, Type } from "@sinclair/typebox";

export const ENDPOINT_EVIDENCE_SCHEMA_VERSION = "dashboard-rpi5.endpoint-evidence.v1" as const;
export const ENDPOINT_EVIDENCE_MAX_EVENTS = 64;

export const EndpointStateSchema = Type.Union([
  Type.Literal("UP"),
  Type.Literal("DOWN"),
  Type.Literal("DEGRADED"),
  Type.Literal("UNKNOWN"),
]);
export type EndpointState = Static<typeof EndpointStateSchema>;

export const EndpointEvidenceEventSchema = Type.Object(
  {
    eventId: Type.String({ minLength: 1, maxLength: 120, pattern: "^[A-Za-z0-9][A-Za-z0-9._:+-]*$" }),
    endpointId: Type.String({ minLength: 1, maxLength: 80, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" }),
    label: Type.String({ minLength: 1, maxLength: 80 }),
    occurredAt: Type.String({ format: "date-time" }),
    fromState: EndpointStateSchema,
    toState: EndpointStateSchema,
    statusCode: Type.Union([Type.Integer({ minimum: 100, maximum: 599 }), Type.Null()]),
    latencyMs: Type.Union([Type.Integer({ minimum: 0, maximum: 300_000 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type EndpointEvidenceEvent = Static<typeof EndpointEvidenceEventSchema>;

export const EndpointEvidenceFileSchema = Type.Object(
  {
    schema: Type.Literal(ENDPOINT_EVIDENCE_SCHEMA_VERSION),
    events: Type.Array(EndpointEvidenceEventSchema, { maxItems: ENDPOINT_EVIDENCE_MAX_EVENTS }),
  },
  { additionalProperties: false },
);
export type EndpointEvidenceFile = Static<typeof EndpointEvidenceFileSchema>;

export const EndpointEvidenceSnapshotSchema = Type.Object(
  {
    observedAt: Type.String({ format: "date-time" }),
    schema: Type.Literal(ENDPOINT_EVIDENCE_SCHEMA_VERSION),
    events: Type.Array(EndpointEvidenceEventSchema, { maxItems: ENDPOINT_EVIDENCE_MAX_EVENTS }),
  },
  { additionalProperties: false },
);
export type EndpointEvidenceSnapshot = Static<typeof EndpointEvidenceSnapshotSchema>;

export const EndpointEvidenceQuerySchema = Type.Object({}, { additionalProperties: false });
export type EndpointEvidenceQuery = Static<typeof EndpointEvidenceQuerySchema>;

const STATES = new Set<EndpointState>(["UP", "DOWN", "DEGRADED", "UNKNOWN"]);
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,119}$/;
const ENDPOINT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const RFC3339_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isSafeLabel(value: string): boolean {
  if (value.length < 1 || value.length > 80 || value.trim() !== value) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 0x20 || codePoint === 0x7f) return false;
  }
  return true;
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

function parseNullableInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error("Invalid endpoint evidence");
  }
  return value;
}

function parseEvent(value: unknown): EndpointEvidenceEvent {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "eventId",
      "endpointId",
      "label",
      "occurredAt",
      "fromState",
      "toState",
      "statusCode",
      "latencyMs",
    ]) ||
    typeof value.eventId !== "string" ||
    !EVENT_ID_PATTERN.test(value.eventId) ||
    typeof value.endpointId !== "string" ||
    !ENDPOINT_ID_PATTERN.test(value.endpointId) ||
    typeof value.label !== "string" ||
    !isSafeLabel(value.label) ||
    !isTimestamp(value.occurredAt) ||
    typeof value.fromState !== "string" ||
    !STATES.has(value.fromState as EndpointState) ||
    typeof value.toState !== "string" ||
    !STATES.has(value.toState as EndpointState) ||
    value.fromState === value.toState
  ) {
    throw new Error("Invalid endpoint evidence");
  }

  return {
    eventId: value.eventId,
    endpointId: value.endpointId,
    label: value.label,
    occurredAt: value.occurredAt,
    fromState: value.fromState as EndpointState,
    toState: value.toState as EndpointState,
    statusCode: parseNullableInteger(value.statusCode, 100, 599),
    latencyMs: parseNullableInteger(value.latencyMs, 0, 300_000),
  };
}

function parseEvents(value: unknown): EndpointEvidenceEvent[] {
  if (!Array.isArray(value) || value.length > ENDPOINT_EVIDENCE_MAX_EVENTS) {
    throw new Error("Invalid endpoint evidence");
  }

  const events = value.map(parseEvent);
  if (new Set(events.map((event) => event.eventId)).size !== events.length) {
    throw new Error("Invalid endpoint evidence");
  }

  return [...events].sort((left, right) => {
    const byTime = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
    return byTime !== 0 ? byTime : left.eventId.localeCompare(right.eventId);
  });
}

export function parseEndpointEvidenceFile(value: unknown): EndpointEvidenceFile {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["schema", "events"]) ||
    value.schema !== ENDPOINT_EVIDENCE_SCHEMA_VERSION
  ) {
    throw new Error("Invalid endpoint evidence");
  }

  return {
    schema: ENDPOINT_EVIDENCE_SCHEMA_VERSION,
    events: parseEvents(value.events),
  };
}

export function parseEndpointEvidenceSnapshot(value: unknown): EndpointEvidenceSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["observedAt", "schema", "events"]) ||
    !isTimestamp(value.observedAt) ||
    value.schema !== ENDPOINT_EVIDENCE_SCHEMA_VERSION
  ) {
    throw new Error("Invalid endpoint evidence");
  }

  return {
    observedAt: value.observedAt,
    schema: ENDPOINT_EVIDENCE_SCHEMA_VERSION,
    events: parseEvents(value.events),
  };
}
