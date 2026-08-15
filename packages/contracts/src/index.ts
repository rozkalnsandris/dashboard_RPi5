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
