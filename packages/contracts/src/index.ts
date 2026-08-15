import { Static, Type } from "@sinclair/typebox";

export const HealthStateSchema = Type.Union([
  Type.Literal("HEALTHY"),
  Type.Literal("ATTENTION"),
  Type.Literal("CRITICAL"),
  Type.Literal("UNKNOWN"),
]);

export type HealthState = Static<typeof HealthStateSchema>;

export const ApiHealthSchema = Type.Object(
  {
    status: Type.Literal("ok"),
    service: Type.Literal("dashboard-rpi5-server"),
    mode: Type.Literal("fixture"),
    observedAt: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);

export type ApiHealth = Static<typeof ApiHealthSchema>;

export const AgentCapabilitySchema = Type.Union([
  Type.Literal("protocol.health"),
]);

export type AgentCapability = Static<typeof AgentCapabilitySchema>;

export const AgentHealthSchema = Type.Object(
  {
    status: Type.Literal("ok"),
    service: Type.Literal("dashboard-rpi5-agent"),
    mode: Type.Literal("SOURCE_ONLY"),
    protocolVersion: Type.Literal(1),
    agentVersion: Type.String({ pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" }),
    capabilities: Type.Array(AgentCapabilitySchema, { uniqueItems: true }),
    observedAt: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);

export type AgentHealth = Static<typeof AgentHealthSchema>;

export const AgentErrorCodeSchema = Type.Union([
  Type.Literal("NOT_FOUND"),
  Type.Literal("INVALID_OPERATION"),
  Type.Literal("OPERATION_TIMEOUT"),
  Type.Literal("INTERNAL_ERROR"),
]);

export type AgentErrorCode = Static<typeof AgentErrorCodeSchema>;

export const AgentErrorSchema = Type.Object(
  {
    error: AgentErrorCodeSchema,
  },
  { additionalProperties: false },
);

export type AgentError = Static<typeof AgentErrorSchema>;

export const ContainerFixtureSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    state: Type.Union([Type.Literal("RUNNING"), Type.Literal("STOPPED")]),
    health: Type.Union([
      Type.Literal("HEALTHY"),
      Type.Literal("UNHEALTHY"),
      Type.Literal("NONE"),
    ]),
    cpuPercent: Type.Number({ minimum: 0 }),
    memoryMiB: Type.Number({ minimum: 0 }),
    networkRxMiB: Type.Number({ minimum: 0 }),
    networkTxMiB: Type.Number({ minimum: 0 }),
    uptime: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type ContainerFixture = Static<typeof ContainerFixtureSchema>;
