import {
  QuickCommandApiErrorSchema,
  QuickCommandCatalogSchema,
  QuickCommandQuerySchema,
  QuickCommandResultSchema,
  QuickCommandRunRequestSchema,
  type QuickCommandRunRequest,
} from "@dashboard-rpi5/contracts/quick-commands";
import type { FastifyInstance } from "fastify";

import {
  AgentQuickCommandTimeoutError,
  createAgentQuickCommandReaders,
  type QuickCommandCatalogReader,
  type QuickCommandRunner,
} from "./agent-quick-commands-client.js";

interface Options {
  readCatalog?: QuickCommandCatalogReader;
  runCommand?: QuickCommandRunner;
  socketPath?: string;
}

export function registerQuickCommandApiRoutes(app: FastifyInstance, options: Options = {}) {
  const defaults =
    options.readCatalog === undefined || options.runCommand === undefined
      ? createAgentQuickCommandReaders(options.socketPath === undefined ? {} : { socketPath: options.socketPath })
      : null;
  const readCatalog = options.readCatalog ?? defaults?.readCatalog;
  const runCommand = options.runCommand ?? defaults?.runCommand;
  if (readCatalog === undefined || runCommand === undefined) {
    throw new Error("Quick command readers are not configured");
  }

  app.get(
    "/api/quick-commands",
    {
      attachValidation: true,
      schema: {
        querystring: QuickCommandQuerySchema,
        response: {
          200: QuickCommandCatalogSchema,
          400: QuickCommandApiErrorSchema,
          503: QuickCommandApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (request.validationError !== undefined) {
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      }
      try {
        return await readCatalog();
      } catch {
        return reply.code(503).send({ error: "SOURCE_UNAVAILABLE" });
      }
    },
  );

  app.post(
    "/api/quick-commands/run",
    {
      attachValidation: true,
      schema: {
        querystring: QuickCommandQuerySchema,
        body: QuickCommandRunRequestSchema,
        response: {
          200: QuickCommandResultSchema,
          400: QuickCommandApiErrorSchema,
          503: QuickCommandApiErrorSchema,
          504: QuickCommandApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (request.validationError !== undefined) {
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      }
      try {
        const { commandId } = request.body as QuickCommandRunRequest;
        return await runCommand(commandId);
      } catch (error: unknown) {
        if (error instanceof AgentQuickCommandTimeoutError) {
          return reply.code(504).send({ error: "OPERATION_TIMEOUT" });
        }
        return reply.code(503).send({ error: "SOURCE_UNAVAILABLE" });
      }
    },
  );
}
