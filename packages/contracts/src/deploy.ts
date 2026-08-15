import { Static, Type } from "@sinclair/typebox";

export const DEPLOY_MAX_EVENTS = 64;

export const DeployVerifiedEventSchema = Type.Object(
  {
    transactionId: Type.String({ pattern: "^\\d{8}T\\d{12}Z-[0-9a-f]{12}$" }),
    commit: Type.String({ pattern: "^[0-9a-f]{12}$" }),
    occurredAt: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);
export type DeployVerifiedEvent = Static<typeof DeployVerifiedEventSchema>;

export const DeployEventsSnapshotSchema = Type.Object(
  {
    observedAt: Type.String({ format: "date-time" }),
    events: Type.Array(DeployVerifiedEventSchema, { maxItems: DEPLOY_MAX_EVENTS }),
  },
  { additionalProperties: false },
);
export type DeployEventsSnapshot = Static<typeof DeployEventsSnapshotSchema>;

export const DeployEventsQuerySchema = Type.Object({}, { additionalProperties: false });
export type DeployEventsQuery = Static<typeof DeployEventsQuerySchema>;

const TRANSACTION_PATTERN = /^(\d{8}T\d{12}Z)-([0-9a-f]{12})$/;
const COMMIT_PATTERN = /^[0-9a-f]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function parseEvent(value: unknown): DeployVerifiedEvent {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["transactionId", "commit", "occurredAt"]) ||
    typeof value.transactionId !== "string" ||
    typeof value.commit !== "string" ||
    !COMMIT_PATTERN.test(value.commit) ||
    !isCanonicalIso(value.occurredAt)
  ) {
    throw new Error("Invalid deploy evidence");
  }
  const match = TRANSACTION_PATTERN.exec(value.transactionId);
  if (match === null || match[2] !== value.commit) {
    throw new Error("Invalid deploy evidence");
  }
  return {
    transactionId: value.transactionId,
    commit: value.commit,
    occurredAt: value.occurredAt,
  };
}

export function parseDeployEventsSnapshot(value: unknown): DeployEventsSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["observedAt", "events"]) ||
    !isCanonicalIso(value.observedAt) ||
    !Array.isArray(value.events) ||
    value.events.length > DEPLOY_MAX_EVENTS
  ) {
    throw new Error("Invalid deploy evidence");
  }

  const events = value.events.map(parseEvent);
  const identities = events.map(
    (event) => `${event.transactionId}:${event.commit}:${event.occurredAt}`,
  );
  if (new Set(identities).size !== events.length) {
    throw new Error("Invalid deploy evidence");
  }
  for (let index = 1; index < events.length; index += 1) {
    if (Date.parse(events[index - 1]!.occurredAt) < Date.parse(events[index]!.occurredAt)) {
      throw new Error("Invalid deploy evidence");
    }
  }
  return { observedAt: value.observedAt, events };
}
