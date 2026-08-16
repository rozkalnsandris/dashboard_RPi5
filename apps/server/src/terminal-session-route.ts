import {
  TerminalSessionApiErrorSchema,
  TerminalSessionCreateRequestSchema,
  TerminalSessionGrantSchema,
} from "@dashboard-rpi5/contracts/terminal";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";

import type { TerminalSessionAdmission } from "./terminal-session-admission.js";

export function registerTerminalSessionRoute(
  app: FastifyInstance,
  terminalSessionAdmission: TerminalSessionAdmission,
): void {
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>();

  typedApp.post(
    "/api/terminal/session",
    {
      attachValidation: true,
      bodyLimit: 64,
      onRequest: async (_request, reply) => {
        reply.header("Cache-Control", "no-store");
      },
      schema: {
        body: TerminalSessionCreateRequestSchema,
        response: {
          201: TerminalSessionGrantSchema,
          400: TerminalSessionApiErrorSchema,
          403: TerminalSessionApiErrorSchema,
          404: TerminalSessionApiErrorSchema,
          409: TerminalSessionApiErrorSchema,
          503: TerminalSessionApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.validationError !== undefined) {
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      }

      const result = await terminalSessionAdmission({
        origin: readSingleHeader(request.raw.headers.origin),
        accessAssertion: readSingleHeader(
          request.raw.headers["cf-access-jwt-assertion"],
        ),
      });

      switch (result.status) {
        case "CREATED":
          return reply.code(201).send({
            sessionToken: result.sessionToken,
            idleTimeoutMs: result.idleTimeoutMs,
            maxLifetimeMs: result.maxLifetimeMs,
          });
        case "TERMINAL_UNAVAILABLE":
          return reply.code(404).send({ error: "TERMINAL_UNAVAILABLE" });
        case "ADMISSION_DENIED":
          return reply.code(403).send({ error: "ADMISSION_DENIED" });
        case "SESSION_LIMIT":
          return reply.code(409).send({ error: "SESSION_LIMIT" });
        case "AUTH_UNAVAILABLE":
          return reply.code(503).send({ error: "AUTH_UNAVAILABLE" });
      }
    },
  );
}

function readSingleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
