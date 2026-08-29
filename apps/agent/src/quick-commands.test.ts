import type {
  QuickCommandId,
  QuickCommandResult,
} from "@dashboard-rpi5/contracts/quick-commands";
import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  createQuickCommandExecutor,
  QUICK_COMMAND_TIMEOUT_MS,
  registerQuickCommandRoutes,
} from "./quick-command-routes.js";
import { OperationTimeoutError } from "./operation-registry.js";
import {
  listQuickCommands,
  QuickCommandSourceUnavailableError,
  runQuickCommand,
} from "./quick-commands.js";

const quickCommandsSource = readFileSync(new URL("./quick-commands.ts", import.meta.url), "utf8");

function createTestApp() {
  return Fastify({
    logger: false,
    ajv: { customOptions: { removeAdditional: false } },
  });
}

function successResult(commandId: QuickCommandId): QuickCommandResult {
  return {
    commandId,
    status: "SUCCESS",
    startedAt: "2026-08-29T00:00:00.000Z",
    finishedAt: "2026-08-29T00:00:00.001Z",
    durationMs: 1,
    exitCode: 0,
    stdout: "ok",
    stderr: "",
  };
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

  it("keeps the fixed runner timeout, output bound and shell-free spawn", () => {
    expect(QUICK_COMMAND_TIMEOUT_MS).toBe(5_000);
    expect(quickCommandsSource).toContain("const MAX_OUTPUT_BYTES = 16 * 1024;");
    expect(quickCommandsSource).toContain("shell: false");
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
      const response = await app.inject({
        method: "POST",
        url: "/v1/quick-commands/run",
        payload: body,
      });
      expect(response.statusCode).toBe(400);
    }

    const queryResponse = await app.inject({
      method: "GET",
      url: "/v1/quick-commands?command=/bin/sh",
    });
    expect(queryResponse.statusCode).toBe(400);
    await app.close();
  });

  it("admits one active run and releases capacity after success and failure", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let calls = 0;

    const runner = vi.fn(async (commandId: QuickCommandId, _signal: AbortSignal) => {
      calls += 1;
      if (calls === 1) {
        markFirstStarted();
        await firstBlocked;
        return successResult(commandId);
      }
      if (calls === 2) {
        throw new QuickCommandSourceUnavailableError();
      }
      return successResult(commandId);
    });

    const app = createTestApp();
    registerQuickCommandRoutes(app, { runner });

    const firstResponse = app.inject({
      method: "POST",
      url: "/v1/quick-commands/run",
      payload: { commandId: "host.uptime" },
    });
    await firstStarted;

    const blockedResponse = await app.inject({
      method: "POST",
      url: "/v1/quick-commands/run",
      payload: { commandId: "host.kernel" },
    });
    expect(blockedResponse.statusCode).toBe(503);
    expect(blockedResponse.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });
    expect(runner).toHaveBeenCalledTimes(1);

    releaseFirst();
    expect((await firstResponse).statusCode).toBe(200);

    const failedResponse = await app.inject({
      method: "POST",
      url: "/v1/quick-commands/run",
      payload: { commandId: "host.kernel" },
    });
    expect(failedResponse.statusCode).toBe(503);

    const recoveredResponse = await app.inject({
      method: "POST",
      url: "/v1/quick-commands/run",
      payload: { commandId: "host.disk-root" },
    });
    expect(recoveredResponse.statusCode).toBe(200);
    expect(runner).toHaveBeenCalledTimes(3);
    await app.close();
  });

  it("aborts at the fixed timeout and releases capacity for the next run", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      let firstSignal: AbortSignal | undefined;
      const runner = vi.fn(
        (commandId: QuickCommandId, signal: AbortSignal): Promise<QuickCommandResult> => {
          calls += 1;
          if (calls === 1) {
            firstSignal = signal;
            return new Promise<QuickCommandResult>(() => undefined);
          }
          return Promise.resolve(successResult(commandId));
        },
      );
      const executeQuickCommand = createQuickCommandExecutor(runner);

      const timedOut = executeQuickCommand("host.uptime");
      const timeoutExpectation = expect(timedOut).rejects.toBeInstanceOf(OperationTimeoutError);
      await vi.advanceTimersByTimeAsync(0);
      expect(firstSignal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(QUICK_COMMAND_TIMEOUT_MS);
      await timeoutExpectation;
      expect(firstSignal?.aborted).toBe(true);

      await expect(executeQuickCommand("host.kernel")).resolves.toEqual(
        successResult("host.kernel"),
      );
      expect(runner).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
