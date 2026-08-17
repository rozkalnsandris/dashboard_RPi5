import {
  DockerContainersSnapshotSchema,
  HostSummarySchema,
} from "@dashboard-rpi5/contracts";
import { CurrentStateApiErrorSchema } from "@dashboard-rpi5/contracts/current-state";
import type { FastifyInstance } from "fastify";

import {
  createAgentDockerContainersReader,
  createAgentHostSummaryReader,
  type DockerContainersReader,
  type HostSummaryReader,
} from "./agent-current-state-client.js";

interface Options {
  readHostSummary?: HostSummaryReader;
  readDockerContainers?: DockerContainersReader;
  socketPath?: string;
}

export function registerCurrentStateApiRoutes(app: FastifyInstance, options: Options = {}) {
  const socketOptions = options.socketPath === undefined ? {} : { socketPath: options.socketPath };
  const readHostSummary = options.readHostSummary ?? createAgentHostSummaryReader(socketOptions);
  const readDockerContainers = options.readDockerContainers ?? createAgentDockerContainersReader(socketOptions);

  app.get(
    "/api/current/host",
    {
      schema: {
        response: {
          200: HostSummarySchema,
          503: CurrentStateApiErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        return await readHostSummary();
      } catch {
        return reply.code(503).send({ error: "SOURCE_UNAVAILABLE" });
      }
    },
  );

  app.get(
    "/api/current/docker",
    {
      schema: {
        response: {
          200: DockerContainersSnapshotSchema,
          503: CurrentStateApiErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      try {
        return await readDockerContainers();
      } catch {
        return reply.code(503).send({ error: "SOURCE_UNAVAILABLE" });
      }
    },
  );
}
