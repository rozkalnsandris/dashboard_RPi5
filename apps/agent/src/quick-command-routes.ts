import {
  QuickCommandApiErrorSchema,
  QuickCommandCatalogSchema,
  QuickCommandQuerySchema,
  QuickCommandResultSchema,
  QuickCommandRunRequestSchema,
  type QuickCommandRunRequest,
} from "@dashboard-rpi5/contracts/quick-commands";
import type { FastifyInstance } from "fastify";

import { OperationTimeoutError } from "./operation-registry.js";
import {
  listQuickCommands,
  QuickCommandOutputLimitError,
  QuickCommandSourceUnavailableError,
  runQuickCommand,
} from "./quick-commands.js";

export const QUICK_COMMAND_MAX_CONCURRENT_RUNS = 1;
export const QUICK_COMMAND_TIMEOUT_MS = 5_000;

type QuickCommandRunner = typeof runQuickCommand;

export class QuickCommandConcurrencyLimitError extends Error {
  constructor() {
    super("Quick command concurrency limit reached");
    this.name = "QuickCommandConcurrencyLimitError";
  }
}

interface QuickCommandExecutorOptions {
  timeoutMs?: number;
}

export function createQuickCommandExecutor(
  runner: QuickCommandRunner = runQuickCommand,
  options: QuickCommandExecutorOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? QUICK_COMMAND_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > QUICK_COMMAND_TIMEOUT_MS) {
    throw new RangeError("Quick Command timeout is outside the allowed range");
  }

  let activeLifecycle:
    | {
        controller: AbortController;
        completion: Promise<void>;
      }
    | undefined;

  const execute = async (commandId: Parameters<QuickCommandRunner>[0]) => {
    if (activeLifecycle !== undefined) {
      throw new QuickCommandConcurrencyLimitError();
    }

    const controller = new AbortController();
    const runnerPromise = Promise.resolve().then(() => runner(commandId, controller.signal));

    let runnerSettled = false;
    let lifecycleCompletion!: Promise<void>;
    lifecycleCompletion = runnerPromise
      .then(
        () => {
          runnerSettled = true;
        },
        () => {
          runnerSettled = true;
        },
      )
      .finally(() => {
        if (activeLifecycle?.completion === lifecycleCompletion) {
          activeLifecycle = undefined;
        }
      });

    activeLifecycle = {
      controller,
      completion: lifecycleCompletion,
    };

    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new OperationTimeoutError());
      }, timeoutMs);
    });

    try {
      return await Promise.race([runnerPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      if (!timedOut || runnerSettled) {
        await lifecycleCompletion;
      }
    }
  };

  const shutdown = async () => {
    const current = activeLifecycle;
    if (current === undefined) return;
    current.controller.abort();
    await current.completion;
  };

  return Object.assign(execute, { shutdown });
}

interface RegisterQuickCommandRoutesOptions {
  runner?: QuickCommandRunner;
}

export function registerQuickCommandRoutes(
  app: FastifyInstance,
  options: RegisterQuickCommandRoutesOptions = {},
) {
  const executeQuickCommand = createQuickCommandExecutor(options.runner);

  app.addHook("onClose", async () => {
    await executeQuickCommand.shutdown();
  });

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
        return await executeQuickCommand(commandId);
      } catch (error: unknown) {
        if (error instanceof OperationTimeoutError) {
          return reply.code(504).send({ error: "OPERATION_TIMEOUT" });
        }
        if (
          error instanceof QuickCommandConcurrencyLimitError ||
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
