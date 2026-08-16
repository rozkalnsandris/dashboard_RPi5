import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { AgentQuickCommandTimeoutError } from "./agent-quick-commands-client.js";
import { registerQuickCommandApiRoutes } from "./quick-command-routes.js";

const catalog = {
  commands: [
    { id: "host.uptime" as const, label: "Uptime", description: "Human-readable host uptime" },
  ],
};

const result = {
  commandId: "host.uptime" as const,
  status: "SUCCESS" as const,
  startedAt: "2026-08-15T20:00:00.000Z",
  finishedAt: "2026-08-15T20:00:00.010Z",
  durationMs: 10,
  exitCode: 0,
  stdout: "up 2 days",
  stderr: "",
};

function createTestApp() {
  return Fastify({
    logger: false,
    ajv: { customOptions: { removeAdditional: false } },
  });
}

describe("quick command API", () => {
  it("returns normalized no-store catalog and result", async () => {
    const app = createTestApp();
    registerQuickCommandApiRoutes(app, {
      readCatalog: async () => catalog,
      runCommand: async (id) => ({ ...result, commandId: id }),
    });

    const list = await app.inject({ method: "GET", url: "/api/quick-commands" });
    expect(list.statusCode).toBe(200);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(list.json()).toEqual(catalog);

    const run = await app.inject({ method: "POST", url: "/api/quick-commands/run", payload: { commandId: "host.uptime" } });
    expect(run.statusCode).toBe(200);
    expect(run.headers["cache-control"]).toBe("no-store");
    expect(run.json()).toEqual(result);
    await app.close();
  });

  it("rejects every browser-controlled selector except commandId", async () => {
    const app = createTestApp();
    registerQuickCommandApiRoutes(app, {
      readCatalog: async () => catalog,
      runCommand: async () => result,
    });

    for (const payload of [
      { commandId: "host.uptime", args: ["--help"] },
      { commandId: "host.uptime", executable: "/bin/sh" },
      { commandId: "host.uptime", path: "/etc/passwd" },
      { commandId: "host.uptime", timeoutMs: 60_000 },
      { commandId: "host.uptime", shell: true },
    ]) {
      const response = await app.inject({ method: "POST", url: "/api/quick-commands/run", payload });
      expect(response.statusCode).toBe(400);
    }
    expect((await app.inject({ method: "GET", url: "/api/quick-commands?path=/tmp" })).statusCode).toBe(400);
    await app.close();
  });

  it("normalizes timeout without leaking internals", async () => {
    const app = createTestApp();
    registerQuickCommandApiRoutes(app, {
      readCatalog: async () => catalog,
      runCommand: async () => { throw new AgentQuickCommandTimeoutError(); },
    });
    const response = await app.inject({ method: "POST", url: "/api/quick-commands/run", payload: { commandId: "host.uptime" } });
    expect(response.statusCode).toBe(504);
    expect(response.json()).toEqual({ error: "OPERATION_TIMEOUT" });
    expect(response.body).not.toContain("socket");
    await app.close();
  });
});
