import { ApiHealthSchema, type ApiHealth } from "@dashboard-rpi5/contracts";
import {
  ActivityApiErrorSchema,
  ActivityQuerySchema,
  ActivitySnapshotSchema,
} from "@dashboard-rpi5/contracts/activity";
import {
  BackupStatusApiErrorSchema,
  BackupStatusQuerySchema,
  BackupStatusSnapshotSchema,
} from "@dashboard-rpi5/contracts/backup-status";
import {
  DashboardApiErrorSchema,
  HostHistoryQuerySchema,
  HostHistorySnapshotSchema,
} from "@dashboard-rpi5/contracts/history";
import {
  LogSnapshotSchema,
  LogSourcesQuerySchema,
  LogSourcesSnapshotSchema,
  LogsApiErrorSchema,
  LogsQuerySchema,
} from "@dashboard-rpi5/contracts/logs";
import {
  SystemdServicesApiErrorSchema,
  SystemdServicesQuerySchema,
  SystemdServicesSnapshotSchema,
} from "@dashboard-rpi5/contracts/services";
import fastifyStatic from "@fastify/static";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";
import { isAbsolute } from "node:path";

import { createAgentBackupEvidenceReader } from "./agent-backup-evidence-client.js";
import { createAgentDeployEventsReader } from "./agent-deploy-events-client.js";
import { createAgentDockerEventsReader } from "./agent-docker-events-client.js";
import { createAgentEndpointEvidenceReader } from "./agent-endpoint-evidence-client.js";
import {
  createAgentLogsReaders,
  type LogsReader,
  type LogSourcesReader,
} from "./agent-logs-client.js";
import { createAgentMaintenanceEventsReader } from "./agent-maintenance-events-client.js";
import {
  createAgentServicesReader,
  type ServicesReader,
} from "./agent-services-client.js";
import { createActivityReader, type ActivityReader } from "./activity.js";
import { createBackupStatusReader, type BackupStatusReader } from "./backup-status.js";
import { createHostHistoryReader, type HostHistoryReader } from "./host-history.js";

interface BuildAppOptions {
  staticRoot?: string;
  historyReader?: HostHistoryReader;
  servicesReader?: ServicesReader;
  activityReader?: ActivityReader;
  backupStatusReader?: BackupStatusReader;
  logSourcesReader?: LogSourcesReader;
  logsReader?: LogsReader;
}

function buildDefaultHistoryReader(): HostHistoryReader {
  return createHostHistoryReader({
    ...(process.env.DASHBOARD_PROMETHEUS_URL === undefined
      ? {}
      : { prometheusBaseUrl: process.env.DASHBOARD_PROMETHEUS_URL }),
    ...(process.env.DASHBOARD_PROMETHEUS_NODE_INSTANCE === undefined
      ? {}
      : { nodeInstance: process.env.DASHBOARD_PROMETHEUS_NODE_INSTANCE }),
    ...(process.env.DASHBOARD_GRAFANA_URL === undefined
      ? {}
      : { grafanaBaseUrl: process.env.DASHBOARD_GRAFANA_URL }),
    ...(process.env.DASHBOARD_GRAFANA_HOST_DASHBOARD_PATH === undefined
      ? {}
      : { grafanaDashboardPath: process.env.DASHBOARD_GRAFANA_HOST_DASHBOARD_PATH }),
  });
}

function agentSocketOptions(): { socketPath?: string } {
  return process.env.DASHBOARD_AGENT_SOCKET_PATH === undefined
    ? {}
    : { socketPath: process.env.DASHBOARD_AGENT_SOCKET_PATH };
}

function buildDefaultServicesReader(): ServicesReader {
  return createAgentServicesReader(agentSocketOptions());
}

function buildDefaultActivityReader(servicesReader: ServicesReader): ActivityReader {
  return createActivityReader({
    dockerEventsReader: createAgentDockerEventsReader(agentSocketOptions()),
    servicesReader,
    backupEvidenceReader: createAgentBackupEvidenceReader(agentSocketOptions()),
    maintenanceEventsReader: createAgentMaintenanceEventsReader(agentSocketOptions()),
    deployEventsReader: createAgentDeployEventsReader(agentSocketOptions()),
    endpointEvidenceReader: createAgentEndpointEvidenceReader(agentSocketOptions()),
  });
}

function buildDefaultBackupStatusReader(): BackupStatusReader {
  return createBackupStatusReader({
    backupEvidenceReader: createAgentBackupEvidenceReader(agentSocketOptions()),
  });
}

function buildDefaultLogsReaders(): {
  readSources: LogSourcesReader;
  readLogs: LogsReader;
} {
  return createAgentLogsReaders(agentSocketOptions());
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  }).withTypeProvider<TypeBoxTypeProvider>();
  const historyReader = options.historyReader ?? buildDefaultHistoryReader();
  const servicesReader = options.servicesReader ?? buildDefaultServicesReader();
  const activityReader = options.activityReader ?? buildDefaultActivityReader(servicesReader);
  const backupStatusReader = options.backupStatusReader ?? buildDefaultBackupStatusReader();
  const defaultLogsReaders =
    options.logSourcesReader === undefined || options.logsReader === undefined
      ? buildDefaultLogsReaders()
      : null;
  const logSourcesReader = options.logSourcesReader ?? defaultLogsReaders?.readSources;
  const logsReader = options.logsReader ?? defaultLogsReaders?.readLogs;
  if (logSourcesReader === undefined || logsReader === undefined) {
    throw new Error("Logs readers are not configured");
  }

  app.get(
    "/api/health",
    {
      schema: {
        response: {
          200: ApiHealthSchema,
        },
      },
    },
    async (): Promise<ApiHealth> => ({
      status: "ok",
      service: "dashboard-rpi5-server",
      mode: "fixture",
      observedAt: new Date().toISOString(),
    }),
  );

  app.get(
    "/api/history/host",
    {
      attachValidation: true,
      schema: {
        querystring: HostHistoryQuerySchema,
        response: {
          200: HostHistorySnapshotSchema,
          400: DashboardApiErrorSchema,
          503: DashboardApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.validationError !== undefined) {
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      }

      try {
        return await historyReader(request.query.range);
      } catch {
        return reply.code(503).send({ error: "SOURCE_UNAVAILABLE" });
      }
    },
  );

  app.get(
    "/api/services",
    {
      attachValidation: true,
      schema: {
        querystring: SystemdServicesQuerySchema,
        response: {
          200: SystemdServicesSnapshotSchema,
          400: SystemdServicesApiErrorSchema,
          503: SystemdServicesApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.validationError !== undefined) {
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      }

      try {
        return await servicesReader();
      } catch {
        return reply.code(503).send({ error: "SOURCE_UNAVAILABLE" });
      }
    },
  );

  app.get(
    "/api/backups",
    {
      attachValidation: true,
      schema: {
        querystring: BackupStatusQuerySchema,
        response: {
          200: BackupStatusSnapshotSchema,
          400: BackupStatusApiErrorSchema,
          503: BackupStatusApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (request.validationError !== undefined) {
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      }

      try {
        return await backupStatusReader();
      } catch {
        return reply.code(503).send({ error: "SOURCE_UNAVAILABLE" });
      }
    },
  );

  app.get(
    "/api/activity",
    {
      attachValidation: true,
      schema: {
        querystring: ActivityQuerySchema,
        response: {
          200: ActivitySnapshotSchema,
          400: ActivityApiErrorSchema,
          503: ActivityApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (request.validationError !== undefined) {
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      }

      try {
        return await activityReader();
      } catch {
        return reply.code(503).send({ error: "SOURCE_UNAVAILABLE" });
      }
    },
  );

  app.get(
    "/api/logs/sources",
    {
      attachValidation: true,
      schema: {
        querystring: LogSourcesQuerySchema,
        response: {
          200: LogSourcesSnapshotSchema,
          400: LogsApiErrorSchema,
          503: LogsApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (request.validationError !== undefined) {
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      }
      try {
        return await logSourcesReader();
      } catch {
        return reply.code(503).send({ error: "SOURCE_UNAVAILABLE" });
      }
    },
  );

  app.get(
    "/api/logs",
    {
      attachValidation: true,
      schema: {
        querystring: LogsQuerySchema,
        response: {
          200: LogSnapshotSchema,
          400: LogsApiErrorSchema,
          503: LogsApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (request.validationError !== undefined) {
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      }
      try {
        return await logsReader(request.query.sourceId, request.query.range);
      } catch {
        return reply.code(503).send({ error: "SOURCE_UNAVAILABLE" });
      }
    },
  );

  if (options.staticRoot !== undefined) {
    if (!isAbsolute(options.staticRoot)) {
      throw new Error("staticRoot must be an absolute path");
    }

    void app.register(fastifyStatic, {
      root: options.staticRoot,
      maxAge: "30d",
      immutable: true,
      serveDotFiles: false,
      setHeaders(reply, pathName) {
        if (pathName.endsWith("index.html")) {
          reply.header("Cache-Control", "no-store");
        }
      },
    });

    app.setNotFoundHandler(async (request, reply) => {
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        !request.url.startsWith("/api/")
      ) {
        return reply
          .header("Cache-Control", "no-store")
          .sendFile("index.html", { maxAge: 0, immutable: false });
      }

      return reply.code(404).send({ error: "NOT_FOUND" });
    });
  }

  return app;
}
