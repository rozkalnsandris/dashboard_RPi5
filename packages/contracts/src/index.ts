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
  Type.Literal("host.summary"),
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

const NonNegativeIntegerSchema = Type.Integer({ minimum: 0 });
const PercentSchema = Type.Number({ minimum: 0, maximum: 100 });

export const HostThrottleFlagsSchema = Type.Object(
  {
    underVoltage: Type.Boolean(),
    armFrequencyCapped: Type.Boolean(),
    throttled: Type.Boolean(),
    softTemperatureLimit: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type HostThrottleFlags = Static<typeof HostThrottleFlagsSchema>;

export const HostSummarySchema = Type.Object(
  {
    observedAt: Type.String({ format: "date-time" }),
    uptimeSeconds: Type.Number({ minimum: 0 }),
    loadAverage: Type.Object(
      {
        oneMinute: Type.Number({ minimum: 0 }),
        fiveMinutes: Type.Number({ minimum: 0 }),
        fifteenMinutes: Type.Number({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    cpu: Type.Object(
      {
        usagePercent: PercentSchema,
        sampleWindowMs: Type.Integer({ minimum: 50, maximum: 2_000 }),
      },
      { additionalProperties: false },
    ),
    memory: Type.Object(
      {
        totalBytes: NonNegativeIntegerSchema,
        availableBytes: NonNegativeIntegerSchema,
        usedBytes: NonNegativeIntegerSchema,
        usedPercent: PercentSchema,
        swapTotalBytes: NonNegativeIntegerSchema,
        swapFreeBytes: NonNegativeIntegerSchema,
        swapUsedBytes: NonNegativeIntegerSchema,
        swapUsedPercent: Type.Union([PercentSchema, Type.Null()]),
      },
      { additionalProperties: false },
    ),
    filesystem: Type.Object(
      {
        path: Type.Literal("/"),
        totalBytes: NonNegativeIntegerSchema,
        availableBytes: NonNegativeIntegerSchema,
        usedBytes: NonNegativeIntegerSchema,
        usedPercent: PercentSchema,
      },
      { additionalProperties: false },
    ),
    temperature: Type.Object(
      {
        celsius: Type.Number({ minimum: -40, maximum: 150 }),
      },
      { additionalProperties: false },
    ),
    throttle: Type.Object(
      {
        rawHex: Type.String({ pattern: "^0x[0-9a-f]+$" }),
        rawValue: Type.Integer({ minimum: 0, maximum: 4_294_967_295 }),
        current: HostThrottleFlagsSchema,
        occurred: HostThrottleFlagsSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type HostSummary = Static<typeof HostSummarySchema>;

export const AgentErrorCodeSchema = Type.Union([
  Type.Literal("NOT_FOUND"),
  Type.Literal("INVALID_OPERATION"),
  Type.Literal("OPERATION_TIMEOUT"),
  Type.Literal("SOURCE_UNAVAILABLE"),
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
