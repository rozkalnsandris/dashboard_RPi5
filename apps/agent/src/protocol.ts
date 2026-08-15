import type { AgentCapability } from "@dashboard-rpi5/contracts/agent";

export const AGENT_SERVICE_NAME = "dashboard-rpi5-agent" as const;
export const AGENT_VERSION = "0.10.0" as const;
export const AGENT_PROTOCOL_VERSION = 1 as const;
export const AGENT_MODE = "SOURCE_ONLY" as const;

export const AGENT_CAPABILITIES = Object.freeze<AgentCapability[]>([
  "protocol.health",
  "host.summary",
  "docker.containers",
  "docker.events.recent",
  "services.status",
  "logs.read",
  "backups.recent",
  "maintenance.events.recent",
  "deploy.events.recent",
]);

export const DEFAULT_OPERATION_TIMEOUT_MS = 5_000;
export const MAX_OPERATION_TIMEOUT_MS = 30_000;
