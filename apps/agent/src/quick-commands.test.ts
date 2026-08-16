import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { registerQuickCommandRoutes } from "./quick-command-routes.js";
import { listQuickCommands, runQuickCommand } from "./quick-commands.js";

function createTestApp() {
  return Fastify({
    logger: false,
    ajv: { customOptions: { removeAdditional: false } },
  });
}

describe("Quick Commands", () => {
  it("publishes only the fixed browser-safe catalog", () => {
    const catalog = listQuickCommands();
    expect(catalog.commands.map((item) => item.id)).toEqual([
      "host.uptime",
      "host.kernel",
      "host.disk-root",
      "host.failed-units",
    ]);
    expect(JSON.stringify(catalog)).not.toMatch(/\/usr\/bin|argv|executable|shell|sudo/i);
  });

  it("runs the fixed kernel diagnostic without shell output controls", async () => {
    const result = await runQuickCommand("host.kernel", new AbortController().signal);
    expect(result.commandId).toBe("host.kernel");
    expect(result.status).toBe("SUCCESS");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout).not.toContain("\u001b");
    expect(result.stderr).toBe("");
  });

  it("rejects arbitrary command, args, path, timeout and query input at the route", async () => {
    const app = createTestApp();
    registerQuickCommandRoutes(app);

    const invalidBodies = [
      { commandId: "../../bin/sh" },
      { commandId: "host.uptime", args: ["-x"] },
      { commandId: "host.uptime", path: "/etc/passwd" },
      { commandId: "host.uptime", timeoutMs: 30_000 },
    ];
    for (const body of invalidBodies) {
      const response = await app.inject({ method: "POST", url: "/v1/quick-commands/run", payload: body });
      expect(response.statusCode).toBe(400);
    }

    const queryResponse = await app.inject({ method: "GET", url: "/v1/quick-commands?command=/bin/sh" });
    expect(queryResponse.statusCode).toBe(400);
    await app.close();
  });
});
