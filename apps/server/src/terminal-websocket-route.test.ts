import Fastify from "fastify";
import { createServer, Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";

import { buildApp } from "./app.js";
import type { OwnerAuthVerifier } from "./terminal-session-admission.js";
import type { TerminalWebSocketAdmission } from "./terminal-websocket-admission.js";
import {
  TERMINAL_EXPECTED_ORIGIN,
  TerminalSessionRegistry,
} from "./terminal-session-security.js";
import { createDefaultTerminalRuntime, type TerminalRuntime } from "./terminal-runtime.js";
import {
  registerTerminalWebSocketPlugin,
  registerTerminalWebSocketRoute,
  TERMINAL_WEBSOCKET_MAX_PAYLOAD_BYTES,
  TERMINAL_WEBSOCKET_PATH,
} from "./terminal-websocket-route.js";
import {
  parseTerminalWebSocketProtocolHeader,
  TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL,
  TERMINAL_WEBSOCKET_SESSION_PROTOCOL_PREFIX,
} from "./terminal-websocket-protocol.js";

const TOKEN_A = "a".repeat(64);
const ACCESS_ASSERTION = "opaque-access-assertion";

const enabledEnv = {
  DASHBOARD_TERMINAL_ENABLED: "enabled",
  DASHBOARD_TERMINAL_ACCESS_TEAM: "example-team",
  DASHBOARD_TERMINAL_ACCESS_AUD: "example-audience",
  DASHBOARD_TERMINAL_OWNER_EMAIL: "owner@example.test",
} as NodeJS.ProcessEnv;

function ownerVerifier(): OwnerAuthVerifier {
  return {
    async verifyAssertion(assertion) {
      if (assertion !== ACCESS_ASSERTION) {
        return { verified: false, reason: "TOKEN_MISSING" };
      }
      return {
        verified: true,
        identity: { email: "owner@example.test", subject: "owner-subject" },
      };
    },
  };
}

function enabledRuntime(): TerminalRuntime {
  return createDefaultTerminalRuntime(enabledEnv, {
    sessionRegistry: new TerminalSessionRegistry({ tokenFactory: () => TOKEN_A }),
    ownerAuthVerifierFactory: () => ownerVerifier(),
  });
}

function websocketHeaders(token = TOKEN_A): Record<string, string> {
  return {
    origin: TERMINAL_EXPECTED_ORIGIN,
    "cf-access-jwt-assertion": ACCESS_ASSERTION,
    "sec-websocket-protocol": `${TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL}, ${TERMINAL_WEBSOCKET_SESSION_PROTOCOL_PREFIX}${token}`,
  };
}

async function mintSession(app: ReturnType<typeof buildApp>): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/terminal/session",
    headers: {
      origin: TERMINAL_EXPECTED_ORIGIN,
      "cf-access-jwt-assertion": ACCESS_ASSERTION,
    },
    payload: {},
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { sessionToken: string }).sessionToken;
}

function mintSessionDirect(runtime: TerminalRuntime): string {
  const result = runtime.sessionRegistry.createSession({
    terminalEnabled: true,
    ownerAuthVerified: true,
    origin: TERMINAL_EXPECTED_ORIGIN,
  });
  if (!result.created) throw new Error("test terminal session was not created");
  return result.session.token;
}

async function waitForClose(socket: {
  once(event: "close", listener: (code: number, reason: Buffer) => void): unknown;
}): Promise<{ code: number; reason: string }> {
  return await new Promise((resolve) => {
    socket.once("close", (code, reason) => {
      resolve({ code, reason: reason.toString("utf8") });
    });
  });
}

async function waitForBrowserOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for WebSocket open")), 1_000);
    timer.unref();
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("WebSocket failed before open"));
      },
      { once: true },
    );
  });
}

async function waitForBrowserTextMessage(socket: WebSocket): Promise<string> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for WebSocket message")), 1_000);
    timer.unref();
    socket.addEventListener(
      "message",
      (event) => {
        clearTimeout(timer);
        if (typeof event.data !== "string") {
          reject(new Error("expected a text WebSocket message"));
          return;
        }
        resolve(event.data);
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("WebSocket failed before message delivery"));
      },
      { once: true },
    );
  });
}

describe("terminal WebSocket route", () => {
  it("keeps ordinary HTTP requests out of the upgrade admission path", async () => {
    const runtime = enabledRuntime();
    const app = buildApp({ terminalRuntime: runtime });
    const response = await app.inject({ method: "GET", url: TERMINAL_WEBSOCKET_PATH });

    expect(response.statusCode).toBe(426);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ error: "UPGRADE_REQUIRED" });
    expect(runtime.sessionRegistry.activeCount()).toBe(0);
    await app.close();
  });

  it("rejects WebSocket upgrades while terminal runtime is disabled", async () => {
    const runtime = createDefaultTerminalRuntime({});
    const app = buildApp({ terminalRuntime: runtime });
    await app.ready();

    await expect(
      app.injectWS(TERMINAL_WEBSOCKET_PATH, { headers: websocketHeaders() }),
    ).rejects.toThrow("Unexpected server response: 404");
    await app.close();
  });

  it("requires owner auth and exact Origin before consuming the session capability", async () => {
    const runtime = enabledRuntime();
    const app = buildApp({ terminalRuntime: runtime });
    const token = await mintSession(app);
    await app.ready();

    const missingAuthHeaders = websocketHeaders(token);
    delete missingAuthHeaders["cf-access-jwt-assertion"];
    await expect(
      app.injectWS(TERMINAL_WEBSOCKET_PATH, { headers: missingAuthHeaders }),
    ).rejects.toThrow("Unexpected server response: 403");

    await expect(
      app.injectWS(TERMINAL_WEBSOCKET_PATH, {
        headers: {
          ...websocketHeaders(token),
          origin: "https://dash.rozkalns.net.evil.example",
        },
      }),
    ).rejects.toThrow("Unexpected server response: 403");

    const socket = await app.injectWS(TERMINAL_WEBSOCKET_PATH, {
      headers: websocketHeaders(token),
    });
    socket.terminate();
    await vi.waitFor(() => expect(runtime.sessionRegistry.activeCount()).toBe(0));
    await app.close();
  });

  it("allows a live capability exactly once and rejects replay", async () => {
    const runtime = enabledRuntime();
    const app = buildApp({ terminalRuntime: runtime });
    const token = await mintSession(app);
    await app.ready();

    const first = await app.injectWS(TERMINAL_WEBSOCKET_PATH, {
      headers: websocketHeaders(token),
    });
    await expect(
      app.injectWS(TERMINAL_WEBSOCKET_PATH, { headers: websocketHeaders(token) }),
    ).rejects.toThrow("Unexpected server response: 403");
    first.terminate();
    await app.close();
  });

  it("delivers the first local ready frame through a real negotiated WebSocket", async () => {
    const runtime = enabledRuntime();
    const token = mintSessionDirect(runtime);
    let localConnection: Socket | undefined;
    let browserSocket: WebSocket | undefined;
    let resolveOpenReceived: (() => void) | undefined;
    const openReceived = new Promise<void>((resolve) => {
      resolveOpenReceived = resolve;
    });
    const localServer = createServer((connection) => {
      localConnection = connection;
      let pending = "";
      connection.setEncoding("utf8");
      connection.on("data", (chunk) => {
        pending += chunk;
        if (!pending.includes("\n")) return;
        resolveOpenReceived?.();
        resolveOpenReceived = undefined;
      });
    });

    await new Promise<void>((resolve, reject) => {
      localServer.once("error", reject);
      localServer.listen(0, "127.0.0.1", resolve);
    });
    const localAddress = localServer.address();
    if (localAddress === null || typeof localAddress === "string") {
      throw new Error("test local server did not expose a TCP port");
    }

    const admission: TerminalWebSocketAdmission = async (input) => {
      const protocol = parseTerminalWebSocketProtocolHeader(input.protocolHeader);
      if (!protocol.parsed || protocol.sessionToken !== token) {
        return { status: "ADMISSION_DENIED" };
      }
      const claim = runtime.sessionRegistry.claimTransport({
        terminalEnabled: true,
        ownerAuthVerified: true,
        origin: TERMINAL_EXPECTED_ORIGIN,
        sessionToken: protocol.sessionToken,
      });
      return claim.claimed
        ? { status: "ALLOWED", sessionToken: protocol.sessionToken }
        : { status: "ADMISSION_DENIED" };
    };

    const app = Fastify();
    registerTerminalWebSocketPlugin(app);
    registerTerminalWebSocketRoute(
      app,
      admission,
      runtime.sessionRegistry,
      () => new Socket().connect(localAddress.port, "127.0.0.1"),
    );

    try {
      await app.listen({ host: "127.0.0.1", port: 0 });
      const webAddress = app.server.address();
      if (webAddress === null || typeof webAddress === "string") {
        throw new Error("test web server did not expose a TCP port");
      }

      browserSocket = new WebSocket(
        `ws://127.0.0.1:${webAddress.port}${TERMINAL_WEBSOCKET_PATH}`,
        [
          TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL,
          `${TERMINAL_WEBSOCKET_SESSION_PROTOCOL_PREFIX}${token}`,
        ],
      );
      await waitForBrowserOpen(browserSocket);
      expect(browserSocket.protocol).toBe(TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL);

      const readyMessage = waitForBrowserTextMessage(browserSocket);
      await openReceived;
      localConnection?.write('{"v":1,"type":"ready"}\n');

      await expect(readyMessage).resolves.toBe('{"type":"ready"}');
      browserSocket.close(1000, "TEST_COMPLETE");
      await vi.waitFor(() => expect(runtime.sessionRegistry.activeCount()).toBe(0));
    } finally {
      if (browserSocket?.readyState === WebSocket.OPEN) browserSocket.close();
      localConnection?.destroy();
      await app.close();
      await new Promise<void>((resolve) => localServer.close(() => resolve()));
    }
  });

  it("fails closed when the source-only local terminal socket is not activated", async () => {
    const runtime = enabledRuntime();
    const app = buildApp({ terminalRuntime: runtime });
    const token = await mintSession(app);
    await app.ready();
    const socket = await app.injectWS(TERMINAL_WEBSOCKET_PATH, {
      headers: websocketHeaders(token),
    });

    await expect(waitForClose(socket)).resolves.toEqual({
      code: 1011,
      reason: "TERMINAL_LOCAL_UNAVAILABLE",
    });
    expect(runtime.sessionRegistry.activeCount()).toBe(0);
    await app.close();
  });

  it("keeps the exact 4 KiB WebSocket max-payload gate ahead of bridge handling", async () => {
    const runtime = enabledRuntime();
    const token = mintSessionDirect(runtime);
    const app = Fastify();
    registerTerminalWebSocketPlugin(app);
    registerTerminalWebSocketRoute(
      app,
      runtime.websocketAdmission,
      runtime.sessionRegistry,
      () => new Socket(),
    );
    await app.ready();

    const socket = await app.injectWS(TERMINAL_WEBSOCKET_PATH, {
      headers: websocketHeaders(token),
    });
    const closed = waitForClose(socket);
    socket.send(Buffer.alloc(TERMINAL_WEBSOCKET_MAX_PAYLOAD_BYTES + 1, 0x61));

    await expect(closed).resolves.toMatchObject({ code: 1009 });
    expect(runtime.sessionRegistry.activeCount()).toBe(0);
    await app.close();
  });

  it("maps auth backend unavailability to a fixed 503 without capability detail", async () => {
    const registry = new TerminalSessionRegistry({ tokenFactory: () => TOKEN_A });
    const runtime: TerminalRuntime = {
      terminalEnabled: true,
      sessionRegistry: registry,
      sessionAdmission: async () => ({ status: "TERMINAL_UNAVAILABLE" }),
      websocketAdmission: async () => ({ status: "AUTH_UNAVAILABLE" }),
    };
    const app = buildApp({ terminalRuntime: runtime });
    await app.ready();

    await expect(
      app.injectWS(TERMINAL_WEBSOCKET_PATH, { headers: websocketHeaders() }),
    ).rejects.toThrow("Unexpected server response: 503");
    expect(registry.activeCount()).toBe(0);
    await app.close();
  });
});