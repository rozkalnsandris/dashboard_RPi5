import fastifyWebsocket from "@fastify/websocket";
import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  createTerminalLocalSocket,
  type TerminalLocalConnector,
} from "./terminal-local-client.js";
import type { TerminalSessionRegistry } from "./terminal-session-security.js";
import type { TerminalWebSocketAdmission } from "./terminal-websocket-admission.js";
import {
  attachTerminalWebSocketBridge,
  type TerminalBridgeWebSocket,
} from "./terminal-websocket-bridge.js";
import { selectTerminalWebSocketApplicationProtocol } from "./terminal-websocket-protocol.js";

export const TERMINAL_WEBSOCKET_PATH = "/api/terminal/ws";
export const TERMINAL_WEBSOCKET_MAX_PAYLOAD_BYTES = 4 * 1024;

export function registerTerminalWebSocketPlugin(app: FastifyInstance): void {
  void app.register(fastifyWebsocket, {
    options: {
      maxPayload: TERMINAL_WEBSOCKET_MAX_PAYLOAD_BYTES,
      perMessageDeflate: false,
      handleProtocols: (protocols) => selectTerminalWebSocketApplicationProtocol(protocols),
    },
  });
}

export function registerTerminalWebSocketRoute(
  app: FastifyInstance,
  admission: TerminalWebSocketAdmission,
  sessionRegistry: TerminalSessionRegistry,
  localConnector: TerminalLocalConnector = createTerminalLocalSocket,
): void {
  void app.register(async (routeScope) => {
    const claimedSessionByRequest = new WeakMap<FastifyRequest, string>();

    routeScope.route({
      method: "GET",
      url: TERMINAL_WEBSOCKET_PATH,
      preValidation: async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        if (!request.ws) return;

        const result = await admission({
          origin: readSingleHeader(request.raw.headers.origin),
          accessAssertion: readSingleHeader(request.raw.headers["cf-access-jwt-assertion"]),
          protocolHeader: request.raw.headers["sec-websocket-protocol"],
        });

        switch (result.status) {
          case "ALLOWED":
            claimedSessionByRequest.set(request, result.sessionToken);
            return;
          case "TERMINAL_UNAVAILABLE":
            await reply.code(404).send({ error: "TERMINAL_UNAVAILABLE" });
            return;
          case "AUTH_UNAVAILABLE":
            await reply.code(503).send({ error: "AUTH_UNAVAILABLE" });
            return;
          case "ADMISSION_DENIED":
            await reply.code(403).send({ error: "ADMISSION_DENIED" });
            return;
        }
      },
      handler: async (_request, reply) => {
        reply.header("Cache-Control", "no-store");
        return reply.code(426).send({ error: "UPGRADE_REQUIRED" });
      },
      wsHandler: (socket, request) => {
        const sessionToken = claimedSessionByRequest.get(request);
        claimedSessionByRequest.delete(request);
        if (sessionToken === undefined) {
          socket.terminate();
          return;
        }

        attachTerminalWebSocketBridge({
          socket: socket as unknown as TerminalBridgeWebSocket,
          sessionToken,
          sessionRegistry,
          localConnector,
        });
      },
    });
  });
}

function readSingleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
