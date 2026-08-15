import { ApiHealthSchema, type ApiHealth } from "@dashboard-rpi5/contracts";
import {
  DashboardApiErrorSchema,
  HostHistoryQuerySchema,
  HostHistorySnapshotSchema,
} from "@dashboard-rpi5/contracts/history";
import {
  SystemdServicesApiErrorSchema,
  SystemdServicesQuerySchema,
  SystemdServicesSnapshotSchema,
} from "@dashboard-rpi5/contracts/services";
import fastifyStatic from "@fastify/static";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";
import { isAbsolute } from "node:path";

import {
  createAgentServicesReader,
  type ServicesReader,
} from "./agent-services-client.js";
import { createHostHistoryReader, type HostHistoryReader } from "./host-history.js";

interface BuildAppOptions {
  staticRoot?: string;
  historyReader?: HostHistoryReader;
  servicesReader?: ServicesReader;
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

function buildDefaultServicesReader(): ServicesReader {
  return createAgentServicesReader({
    ...(process.env.DASHBOARD_AGENT_SOCKET_PATH === undefined
      ? {}
      : { socketPath: process.env.DASHBOARD_AGENT_SOCKET_PATH }),
  });
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
