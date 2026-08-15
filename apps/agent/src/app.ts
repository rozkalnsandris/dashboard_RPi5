import {
  AgentErrorSchema,
  DockerContainersSnapshotSchema,
  DockerRecentEventsSnapshotSchema,
  HostSummarySchema,
  type DockerContainersSnapshot,
  type DockerRecentEventsSnapshot,
  type HostSummary,
} from "@dashboard-rpi5/contracts";
import { AgentHealthSchema, type AgentHealth } from "@dashboard-rpi5/contracts/agent";
import {
  LogSnapshotSchema,
  LogSourcesQuerySchema,
  LogSourcesSnapshotSchema,
  LogsQuerySchema,
  type LogRange,
  type LogSnapshot,
  type LogSourceId,
  type LogSourcesSnapshot,
} from "@dashboard-rpi5/contracts/logs";
import {
  SystemdServicesSnapshotSchema,
  type SystemdServicesSnapshot,
} from "@dashboard-rpi5/contracts/services";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";

import { readRecentDockerEvents } from "./docker-events.js";
import { readDockerContainers } from "./docker-read.js";
import { readHostSummary } from "./host-read.js";
import { listRegisteredLogSources, readLogSnapshot } from "./logs-read.js";
import {
  normalizeAgentError,
  OperationRegistry,
  runWithTimeout,
} from "./operation-registry.js";
import {
  AGENT_CAPABILITIES,
  AGENT_MODE,
  AGENT_PROTOCOL_VERSION,
  AGENT_SERVICE_NAME,
  AGENT_VERSION,
} from "./protocol.js";
import { readSystemdServices } from "./systemd-services.js";

interface BuildAgentAppOptions {
  operationRegistry?: OperationRegistry;
  hostSummaryReader?: (signal: AbortSignal) => Promise<HostSummary>;
  dockerContainersReader?: (signal: AbortSignal) => Promise<DockerContainersSnapshot>;
  dockerEventsReader?: (signal: AbortSignal) => Promise<DockerRecentEventsSnapshot>;
  servicesReader?: (signal: AbortSignal) => Promise<SystemdServicesSnapshot>;
  logSourcesReader?: () => LogSourcesSnapshot;
  logsReader?: (
    sourceId: LogSourceId,
    range: LogRange,
    signal: AbortSignal,
  ) => Promise<LogSnapshot>;
}

export function buildAgentApp(options: BuildAgentAppOptions = {}) {
  const operationRegistry = options.operationRegistry ?? new OperationRegistry();
  const hostSummaryReader =
    options.hostSummaryReader ?? ((signal: AbortSignal) => readHostSummary(undefined, signal));
  const dockerContainersReader =
    options.dockerContainersReader ??
    ((signal: AbortSignal) => readDockerContainers(undefined, signal));
  const dockerEventsReader =
    options.dockerEventsReader ??
    ((signal: AbortSignal) => readRecentDockerEvents(undefined, signal));
  const servicesReader =
    options.servicesReader ??
    ((signal: AbortSignal) => readSystemdServices(undefined, signal));
  const logSourcesReader = options.logSourcesReader ?? (() => listRegisteredLogSources());
  const logsReader =
    options.logsReader ??
    ((sourceId: LogSourceId, range: LogRange, signal: AbortSignal) =>
      readLogSnapshot(sourceId, range, undefined, signal));

  operationRegistry.register("host.summary", hostSummaryReader);
  operationRegistry.register("docker.containers", dockerContainersReader);
  operationRegistry.register("docker.events.recent", dockerEventsReader);
  operationRegistry.register("services.status", servicesReader);

  const app = Fastify({
    logger: false,
    bodyLimit: 16 * 1024,
    requestTimeout: 5_000,
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    "/v1/health",
    {
      schema: {
        response: {
          200: AgentHealthSchema,
        },
      },
    },
    async (): Promise<AgentHealth> => ({
      status: "ok",
      service: AGENT_SERVICE_NAME,
      mode: AGENT_MODE,
      protocolVersion: AGENT_PROTOCOL_VERSION,
      agentVersion: AGENT_VERSION,
      capabilities: [...AGENT_CAPABILITIES],
      observedAt: new Date().toISOString(),
    }),
  );

  app.get(
    "/v1/host/summary",
    {
      schema: {
        response: {
          200: HostSummarySchema,
          503: AgentErrorSchema,
          504: AgentErrorSchema,
        },
      },
    },
    async (): Promise<HostSummary> => operationRegistry.run<HostSummary>("host.summary"),
  );

  app.get(
    "/v1/docker/containers",
    {
      schema: {
        response: {
          200: DockerContainersSnapshotSchema,
          503: AgentErrorSchema,
          504: AgentErrorSchema,
        },
      },
    },
    async (): Promise<DockerContainersSnapshot> =>
      operationRegistry.run<DockerContainersSnapshot>("docker.containers"),
  );

  app.get(
    "/v1/docker/events/recent",
    {
      schema: {
        response: {
          200: DockerRecentEventsSnapshotSchema,
          503: AgentErrorSchema,
          504: AgentErrorSchema,
        },
      },
    },
    async (): Promise<DockerRecentEventsSnapshot> =>
      operationRegistry.run<DockerRecentEventsSnapshot>("docker.events.recent"),
  );

  app.get(
    "/v1/services",
    {
      schema: {
        response: {
          200: SystemdServicesSnapshotSchema,
          503: AgentErrorSchema,
          504: AgentErrorSchema,
        },
      },
    },
    async (): Promise<SystemdServicesSnapshot> =>
      operationRegistry.run<SystemdServicesSnapshot>("services.status"),
  );

  app.get(
    "/v1/logs/sources",
    {
      attachValidation: true,
      schema: {
        querystring: LogSourcesQuerySchema,
        response: {
          200: LogSourcesSnapshotSchema,
          400: AgentErrorSchema,
          503: AgentErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.validationError !== undefined) {
        return reply.code(400).send({ error: "INVALID_OPERATION" });
      }
      try {
        return logSourcesReader();
      } catch {
        return reply.code(503).send({ error: "SOURCE_UNAVAILABLE" });
      }
    },
  );

  app.get(
    "/v1/logs",
    {
      attachValidation: true,
      schema: {
        querystring: LogsQuerySchema,
        response: {
          200: LogSnapshotSchema,
          400: AgentErrorSchema,
          503: AgentErrorSchema,
          504: AgentErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.validationError !== undefined) {
        return reply.code(400).send({ error: "INVALID_OPERATION" });
      }
      return runWithTimeout((signal) =>
        logsReader(request.query.sourceId, request.query.range, signal),
      );
    },
  );

  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({ error: "NOT_FOUND" }),
  );

  app.setErrorHandler(async (error, _request, reply) => {
    const normalized = normalizeAgentError(error);
    const statusCode =
      normalized.error === "INVALID_OPERATION"
        ? 400
        : normalized.error === "OPERATION_TIMEOUT"
          ? 504
          : normalized.error === "SOURCE_UNAVAILABLE"
            ? 503
            : 500;

    return reply
      .code(statusCode)
      .type("application/json")
      .send(normalized);
  });

  return { app, operationRegistry };
}
