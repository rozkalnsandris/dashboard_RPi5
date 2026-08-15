import {
  AgentErrorSchema,
  AgentHealthSchema,
  type AgentHealth,
} from "@dashboard-rpi5/contracts";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";

import { normalizeAgentError, OperationRegistry } from "./operation-registry.js";
import {
  AGENT_CAPABILITIES,
  AGENT_MODE,
  AGENT_PROTOCOL_VERSION,
  AGENT_SERVICE_NAME,
  AGENT_VERSION,
} from "./protocol.js";

interface BuildAgentAppOptions {
  operationRegistry?: OperationRegistry;
}

export function buildAgentApp(options: BuildAgentAppOptions = {}) {
  const operationRegistry = options.operationRegistry ?? new OperationRegistry();
  const app = Fastify({
    logger: false,
    bodyLimit: 16 * 1024,
    requestTimeout: 5_000,
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
          : 500;

    return reply
      .code(statusCode)
      .type("application/json")
      .send(normalized);
  });

  app.addSchema(AgentErrorSchema);

  return { app, operationRegistry };
}
