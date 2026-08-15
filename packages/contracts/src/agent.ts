import { Static, Type } from "@sinclair/typebox";

export const AgentCapabilitySchema = Type.Union([
  Type.Literal("protocol.health"),
  Type.Literal("host.summary"),
  Type.Literal("docker.containers"),
  Type.Literal("docker.events.recent"),
  Type.Literal("services.status"),
  Type.Literal("logs.read"),
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
