import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { TerminalSessionAdmission } from "./terminal-session-admission.js";
import { registerTerminalSessionRoute } from "./terminal-session-route.js";

const TOKEN = "a".repeat(64);
const ASSERTION = "sensitive.header.payload.signature";
const ORIGIN = "https://dash.rozkalns.net";

function buildRouteApp(admission: TerminalSessionAdmission) {
  const app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  });
  registerTerminalSessionRoute(app, admission);
  return app;
}

describe("terminal session route", () => {
  it("passes only the security headers into admission and returns a no-store grant", async () => {
    const admission: TerminalSessionAdmission = vi.fn(async () => ({
      status: "CREATED",
      sessionToken: TOKEN,
      idleTimeoutMs: 300_000,
      maxLifetimeMs: 1_800_000,
    }));
    const app = buildRouteApp(admission);

    const response = await app.inject({
      method: "POST",
      url: "/api/terminal/session",
      headers: {
        origin: ORIGIN,
        "cf-access-jwt-assertion": ASSERTION,
      },
      payload: {},
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      sessionToken: TOKEN,
      idleTimeoutMs: 300_000,
      maxLifetimeMs: 1_800_000,
    });
    expect(admission).toHaveBeenCalledWith({
      origin: ORIGIN,
      accessAssertion: ASSERTION,
    });

    await app.close();
  });

  it.each([
    ["TERMINAL_UNAVAILABLE", 404, "TERMINAL_UNAVAILABLE"],
    ["ADMISSION_DENIED", 403, "ADMISSION_DENIED"],
    ["SESSION_LIMIT", 409, "SESSION_LIMIT"],
    ["AUTH_UNAVAILABLE", 503, "AUTH_UNAVAILABLE"],
  ] as const)("maps %s to its bounded API status", async (status, code, error) => {
    const admission: TerminalSessionAdmission = vi.fn(async () => ({ status }));
    const app = buildRouteApp(admission);

    const response = await app.inject({
      method: "POST",
      url: "/api/terminal/session",
      headers: {
        origin: ORIGIN,
        "cf-access-jwt-assertion": ASSERTION,
      },
      payload: {},
    });

    expect(response.statusCode).toBe(code);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ error });
    expect(response.body).not.toContain(ASSERTION);

    await app.close();
  });

  it("rejects unexpected request body fields before admission", async () => {
    const admission: TerminalSessionAdmission = vi.fn(async () => ({
      status: "TERMINAL_UNAVAILABLE",
    }));
    const app = buildRouteApp(admission);

    const response = await app.inject({
      method: "POST",
      url: "/api/terminal/session",
      headers: {
        origin: ORIGIN,
        "cf-access-jwt-assertion": ASSERTION,
      },
      payload: { command: "whoami" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ error: "INVALID_REQUEST" });
    expect(admission).not.toHaveBeenCalled();
    expect(response.body).not.toContain(ASSERTION);

    await app.close();
  });

  it("sets no-store even when Fastify rejects an oversized body before the handler", async () => {
    const admission: TerminalSessionAdmission = vi.fn(async () => ({
      status: "TERMINAL_UNAVAILABLE",
    }));
    const app = buildRouteApp(admission);

    const response = await app.inject({
      method: "POST",
      url: "/api/terminal/session",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "cf-access-jwt-assertion": ASSERTION,
      },
      payload: JSON.stringify({ padding: "x".repeat(128) }),
    });

    expect(response.statusCode).toBe(413);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(admission).not.toHaveBeenCalled();
    expect(response.body).not.toContain(ASSERTION);

    await app.close();
  });

  it("treats missing security headers as absent instead of synthesizing identity", async () => {
    const admission: TerminalSessionAdmission = vi.fn(async () => ({
      status: "ADMISSION_DENIED",
    }));
    const app = buildRouteApp(admission);

    const response = await app.inject({
      method: "POST",
      url: "/api/terminal/session",
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(admission).toHaveBeenCalledWith({
      origin: undefined,
      accessAssertion: undefined,
    });

    await app.close();
  });
});
