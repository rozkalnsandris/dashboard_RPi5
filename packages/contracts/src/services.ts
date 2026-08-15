import { Static, Type } from "@sinclair/typebox";

export const SystemdServiceLoadStateSchema = Type.Union([
  Type.Literal("LOADED"),
  Type.Literal("NOT_FOUND"),
  Type.Literal("BAD_SETTING"),
  Type.Literal("ERROR"),
  Type.Literal("MASKED"),
  Type.Literal("UNKNOWN"),
]);
export type SystemdServiceLoadState = Static<typeof SystemdServiceLoadStateSchema>;

export const SystemdServiceActiveStateSchema = Type.Union([
  Type.Literal("ACTIVE"),
  Type.Literal("RELOADING"),
  Type.Literal("INACTIVE"),
  Type.Literal("FAILED"),
  Type.Literal("ACTIVATING"),
  Type.Literal("DEACTIVATING"),
  Type.Literal("MAINTENANCE"),
  Type.Literal("REFRESHING"),
  Type.Literal("UNKNOWN"),
]);
export type SystemdServiceActiveState = Static<typeof SystemdServiceActiveStateSchema>;

export const SystemdServiceEnablementSchema = Type.Union([
  Type.Literal("ENABLED"),
  Type.Literal("ENABLED_RUNTIME"),
  Type.Literal("DISABLED"),
  Type.Literal("STATIC"),
  Type.Literal("MASKED"),
  Type.Literal("MASKED_RUNTIME"),
  Type.Literal("INDIRECT"),
  Type.Literal("GENERATED"),
  Type.Literal("TRANSIENT"),
  Type.Literal("ALIAS"),
  Type.Literal("LINKED"),
  Type.Literal("LINKED_RUNTIME"),
  Type.Literal("UNKNOWN"),
]);
export type SystemdServiceEnablement = Static<typeof SystemdServiceEnablementSchema>;

const NullableStateAgeSchema = Type.Union([
  Type.Number({ minimum: 0 }),
  Type.Null(),
]);

export const SystemdServiceSnapshotSchema = Type.Object(
  {
    unitId: Type.String({
      minLength: 9,
      maxLength: 128,
      pattern: "^[A-Za-z0-9_.@:-]+\\.service$",
    }),
    label: Type.String({ minLength: 1, maxLength: 80 }),
    loadState: SystemdServiceLoadStateSchema,
    activeState: SystemdServiceActiveStateSchema,
    subState: Type.Union([
      Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_-]+$" }),
      Type.Null(),
    ]),
    enablement: SystemdServiceEnablementSchema,
    restartCount: Type.Union([
      Type.Integer({ minimum: 0 }),
      Type.Null(),
    ]),
    stateAgeSeconds: NullableStateAgeSchema,
  },
  { additionalProperties: false },
);
export type SystemdServiceSnapshot = Static<typeof SystemdServiceSnapshotSchema>;

export const SystemdServicesSnapshotSchema = Type.Object(
  {
    observedAt: Type.String({ format: "date-time" }),
    services: Type.Array(SystemdServiceSnapshotSchema, { maxItems: 32 }),
  },
  { additionalProperties: false },
);
export type SystemdServicesSnapshot = Static<typeof SystemdServicesSnapshotSchema>;

export const SystemdServicesQuerySchema = Type.Object({}, { additionalProperties: false });
export type SystemdServicesQuery = Static<typeof SystemdServicesQuerySchema>;

export const SystemdServicesApiErrorSchema = Type.Object(
  {
    error: Type.Union([
      Type.Literal("INVALID_REQUEST"),
      Type.Literal("SOURCE_UNAVAILABLE"),
    ]),
  },
  { additionalProperties: false },
);
export type SystemdServicesApiError = Static<typeof SystemdServicesApiErrorSchema>;

const LOAD_STATES = new Set<SystemdServiceLoadState>([
  "LOADED",
  "NOT_FOUND",
  "BAD_SETTING",
  "ERROR",
  "MASKED",
  "UNKNOWN",
]);
const ACTIVE_STATES = new Set<SystemdServiceActiveState>([
  "ACTIVE",
  "RELOADING",
  "INACTIVE",
  "FAILED",
  "ACTIVATING",
  "DEACTIVATING",
  "MAINTENANCE",
  "REFRESHING",
  "UNKNOWN",
]);
const ENABLEMENT_STATES = new Set<SystemdServiceEnablement>([
  "ENABLED",
  "ENABLED_RUNTIME",
  "DISABLED",
  "STATIC",
  "MASKED",
  "MASKED_RUNTIME",
  "INDIRECT",
  "GENERATED",
  "TRANSIENT",
  "ALIAS",
  "LINKED",
  "LINKED_RUNTIME",
  "UNKNOWN",
]);
const UNIT_ID_PATTERN = /^[A-Za-z0-9_.@:-]+\.service$/;
const SUB_STATE_PATTERN = /^[A-Za-z0-9_-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseService(value: unknown): SystemdServiceSnapshot {
  if (!isRecord(value)) throw new Error("Invalid services response");
  if (
    !hasOnlyKeys(value, [
      "unitId",
      "label",
      "loadState",
      "activeState",
      "subState",
      "enablement",
      "restartCount",
      "stateAgeSeconds",
    ]) ||
    typeof value.unitId !== "string" ||
    value.unitId.length > 128 ||
    !UNIT_ID_PATTERN.test(value.unitId) ||
    typeof value.label !== "string" ||
    value.label.length < 1 ||
    value.label.length > 80 ||
    typeof value.loadState !== "string" ||
    !LOAD_STATES.has(value.loadState as SystemdServiceLoadState) ||
    typeof value.activeState !== "string" ||
    !ACTIVE_STATES.has(value.activeState as SystemdServiceActiveState) ||
    typeof value.enablement !== "string" ||
    !ENABLEMENT_STATES.has(value.enablement as SystemdServiceEnablement)
  ) {
    throw new Error("Invalid services response");
  }

  if (
    value.subState !== null &&
    (typeof value.subState !== "string" ||
      value.subState.length > 64 ||
      !SUB_STATE_PATTERN.test(value.subState))
  ) {
    throw new Error("Invalid services response");
  }

  if (
    value.restartCount !== null &&
    (typeof value.restartCount !== "number" ||
      !Number.isSafeInteger(value.restartCount) ||
      value.restartCount < 0)
  ) {
    throw new Error("Invalid services response");
  }

  if (
    value.stateAgeSeconds !== null &&
    (typeof value.stateAgeSeconds !== "number" ||
      !Number.isFinite(value.stateAgeSeconds) ||
      value.stateAgeSeconds < 0)
  ) {
    throw new Error("Invalid services response");
  }

  return {
    unitId: value.unitId,
    label: value.label,
    loadState: value.loadState as SystemdServiceLoadState,
    activeState: value.activeState as SystemdServiceActiveState,
    subState: value.subState as string | null,
    enablement: value.enablement as SystemdServiceEnablement,
    restartCount: value.restartCount as number | null,
    stateAgeSeconds: value.stateAgeSeconds as number | null,
  };
}

export function parseSystemdServicesSnapshot(value: unknown): SystemdServicesSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["observedAt", "services"]) ||
    typeof value.observedAt !== "string" ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    !Array.isArray(value.services) ||
    value.services.length > 32
  ) {
    throw new Error("Invalid services response");
  }

  const services = value.services.map(parseService);
  if (new Set(services.map((service) => service.unitId)).size !== services.length) {
    throw new Error("Invalid services response");
  }

  return { observedAt: value.observedAt, services };
}
