import {
  QuickCommandApiErrorSchema,
  QuickCommandCatalogSchema,
  QuickCommandQuerySchema,
  QuickCommandResultSchema,
  QuickCommandRunRequestSchema,
  type QuickCommandRunRequest,
} from "@dashboard-rpi5/contracts/quick-commands";
import type { FastifyInstance } from "fastify";

import { OperationTimeoutError, runWithTimeout } from "./operation-registry.js";
import {
  listQuickCommands,
  QuickCommandOutputLimitError,
  QuickCommandSourceUnavailableError,
  runQuickCommand,
} from "./quick-commands.js";

export function registerQuickCommandRoutes(app: FastifyInstance) {
  app.get(
    "/v1/quick-commands",
    {
      attachValidation: true,
      schema: {
        querystring: QuickCommandQuerySchema,
        response: {
          200: QuickCommandCatalogSchema,
          400: QuickCommandApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.validationError !== undefined) {
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      }
      return listQuickCommands();
    },
  );

  app.post(
    "/v1/quick-commands/run",
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
      if (request.validationError !== undefined) {
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      }

      const { commandId } = request.body as QuickCommandRunRequest;
      try {
        return await runWithTimeout((signal) => runQuickCommand(commandId, signal), 5_000);
      } catch (error: unknown) {
        if (error instanceof OperationTimeoutError) {
          return reply.code(504).send({ error: "OPERATION_TIMEOUT" });
        }
        if (
          error instanceof QuickCommandSourceUnavailableError ||
          error instanceof QuickCommandOutputLimitError
        ) {
          return reply.code(503).send({ error: "SOURCE_UNAVAILABLE" });
        }
        throw error;
      }
    },
  );
}
