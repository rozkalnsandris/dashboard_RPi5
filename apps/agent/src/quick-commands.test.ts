import type {
  QuickCommandId,
  QuickCommandResult,
} from "@dashboard-rpi5/contracts/quick-commands";
import Fastify from "fastify";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  createQuickCommandExecutor,
  QUICK_COMMAND_TIMEOUT_MS,
  QuickCommandConcurrencyLimitError,
  registerQuickCommandRoutes,
} from "./quick-command-routes.js";
import { OperationTimeoutError } from "./operation-registry.js";
import {
  listQuickCommands,
  QUICK_COMMAND_TERMINATION_GRACE_MS,
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
    expect(QUICK_COMMAND_TERMINATION_GRACE_MS).toBe(250);
    expect(quickCommandsSource).toContain("const MAX_OUTPUT_BYTES = 16 * 1024;");
    expect(quickCommandsSource).toContain("shell: false");
    expect(quickCommandsSource).toContain('child.kill("SIGTERM")');
    expect(quickCommandsSource).toContain('child.kill("SIGKILL")');
    expect(quickCommandsSource).toContain('child.once("close"');
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

  it("admits one active run and releases capacity after lifecycle completion", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let calls = 0;

    const runner = vi.fn(async (commandId: QuickCommandId) => {
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

  it("does not release capacity when request timeout fires before lifecycle completion", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      let firstSignal: AbortSignal | undefined;
      let releaseFirst!: () => void;

      const runner = vi.fn(
        (commandId: QuickCommandId, signal: AbortSignal): Promise<QuickCommandResult> => {
          calls += 1;
          if (calls === 1) {
            firstSignal = signal;
            return new Promise<QuickCommandResult>((resolve) => {
              releaseFirst = () => resolve(successResult(commandId));
            });
          }
          return Promise.resolve(successResult(commandId));
        },
      );
      const executeQuickCommand = createQuickCommandExecutor(runner, { timeoutMs: 25 });

      const timedOut = executeQuickCommand("host.uptime");
      const timeoutExpectation = expect(timedOut).rejects.toBeInstanceOf(OperationTimeoutError);
      await vi.advanceTimersByTimeAsync(25);
      await timeoutExpectation;
      expect(firstSignal?.aborted).toBe(true);

      await expect(executeQuickCommand("host.kernel")).rejects.toBeInstanceOf(
        QuickCommandConcurrencyLimitError,
      );
      expect(runner).toHaveBeenCalledTimes(1);

      releaseFirst();
      await Promise.resolve();
      await Promise.resolve();

      await expect(executeQuickCommand("host.kernel")).resolves.toEqual(
        successResult("host.kernel"),
      );
      expect(runner).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps capacity while a real child ignores SIGTERM and releases only after close", async () => {
    let calls = 0;
    let childClosed = false;
    let markChildReady!: () => void;
    const childReady = new Promise<void>((resolve) => {
      markChildReady = resolve;
    });

    const runner = vi.fn(
      (commandId: QuickCommandId, signal: AbortSignal): Promise<QuickCommandResult> => {
        calls += 1;
        if (calls > 1) {
          return Promise.resolve(successResult(commandId));
        }

        return new Promise<QuickCommandResult>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              "-e",
              'process.on("SIGTERM", () => {}); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);',
            ],
            {
              shell: false,
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          let killTimer: ReturnType<typeof setTimeout> | undefined;

          child.stdout.once("data", () => {
            markChildReady();
          });
          child.once("error", reject);
          child.once("close", () => {
            childClosed = true;
            if (killTimer !== undefined) clearTimeout(killTimer);
            resolve(successResult(commandId));
          });

          signal.addEventListener(
            "abort",
            () => {
              child.kill("SIGTERM");
              killTimer = setTimeout(() => {
                if (!childClosed) child.kill("SIGKILL");
              }, 40);
            },
            { once: true },
          );
        });
      },
    );

    const executeQuickCommand = createQuickCommandExecutor(runner, { timeoutMs: 500 });
    const firstRequest = executeQuickCommand("host.uptime");
    await childReady;

    await expect(firstRequest).rejects.toBeInstanceOf(OperationTimeoutError);
    expect(childClosed).toBe(false);
    await expect(executeQuickCommand("host.kernel")).rejects.toBeInstanceOf(
      QuickCommandConcurrencyLimitError,
    );

    const deadline = Date.now() + 2_000;
    while (!childClosed && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(childClosed).toBe(true);

    await expect(executeQuickCommand("host.kernel")).resolves.toEqual(
      successResult("host.kernel"),
    );
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("aborts and waits for the active lifecycle during executor shutdown", async () => {
    let activeSignal: AbortSignal | undefined;
    let releaseActive!: () => void;
    const runner = vi.fn(
      (commandId: QuickCommandId, signal: AbortSignal): Promise<QuickCommandResult> => {
        activeSignal = signal;
        return new Promise<QuickCommandResult>((resolve) => {
          releaseActive = () => resolve(successResult(commandId));
        });
      },
    );
    const executeQuickCommand = createQuickCommandExecutor(runner, { timeoutMs: 1_000 });

    const activeRequest = executeQuickCommand("host.uptime");
    await Promise.resolve();

    let shutdownCompleted = false;
    const shutdown = executeQuickCommand.shutdown().then(() => {
      shutdownCompleted = true;
    });
    expect(activeSignal?.aborted).toBe(true);
    await Promise.resolve();
    expect(shutdownCompleted).toBe(false);
    await expect(executeQuickCommand("host.kernel")).rejects.toBeInstanceOf(
      QuickCommandConcurrencyLimitError,
    );

    releaseActive();
    await shutdown;
    expect(shutdownCompleted).toBe(true);
    await expect(activeRequest).resolves.toEqual(successResult("host.uptime"));
  });
});
