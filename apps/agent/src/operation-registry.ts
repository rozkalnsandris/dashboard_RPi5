import type { AgentError } from "@dashboard-rpi5/contracts";

import { BackupSourceUnavailableError } from "./backup-evidence.js";
import { DeploySourceUnavailableError } from "./deploy-events.js";
import { DockerSourceUnavailableError } from "./docker-read.js";
import { HostSourceUnavailableError } from "./host-read.js";
import { LogSourceUnavailableError } from "./logs-read.js";
import { MaintenanceSourceUnavailableError } from "./maintenance-events.js";
import {
  DEFAULT_OPERATION_TIMEOUT_MS,
  MAX_OPERATION_TIMEOUT_MS,
} from "./protocol.js";
import { SystemdSourceUnavailableError } from "./systemd-services.js";

const OPERATION_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

export type AgentOperationHandler<T = unknown> = (signal: AbortSignal) => Promise<T>;

export class UnknownOperationError extends Error {
  constructor() {
    super("Unknown agent operation");
    this.name = "UnknownOperationError";
  }
}

export class OperationTimeoutError extends Error {
  constructor() {
    super("Agent operation timed out");
    this.name = "OperationTimeoutError";
  }
}

export class InvalidOperationRegistrationError extends Error {
  constructor() {
    super("Invalid agent operation registration");
    this.name = "InvalidOperationRegistrationError";
  }
}

function validateTimeout(timeoutMs: number) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_OPERATION_TIMEOUT_MS
  ) {
    throw new RangeError("Agent operation timeout is outside the allowed range");
  }
}

export async function runWithTimeout<T>(
  handler: AgentOperationHandler<T>,
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
): Promise<T> {
  validateTimeout(timeoutMs);

  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    const timer = setTimeout(() => {
      controller.abort();
      finish(() => reject(new OperationTimeoutError()));
    }, timeoutMs);

    Promise.resolve()
      .then(() => handler(controller.signal))
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}

export class OperationRegistry {
  readonly #handlers = new Map<string, AgentOperationHandler>();

  register<T>(id: string, handler: AgentOperationHandler<T>) {
    if (!OPERATION_ID_PATTERN.test(id) || this.#handlers.has(id)) {
      throw new InvalidOperationRegistrationError();
    }

    this.#handlers.set(id, handler as AgentOperationHandler);
  }

  has(id: string) {
    return this.#handlers.has(id);
  }

  list() {
    return [...this.#handlers.keys()].sort();
  }

  async run<T = unknown>(
    id: string,
    options: { timeoutMs?: number } = {},
  ): Promise<T> {
    const handler = this.#handlers.get(id);
    if (handler === undefined) {
      throw new UnknownOperationError();
    }

    return runWithTimeout(
      handler as AgentOperationHandler<T>,
      options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS,
    );
  }
}

export function normalizeAgentError(error: unknown): AgentError {
  if (error instanceof UnknownOperationError) {
    return { error: "INVALID_OPERATION" };
  }

  if (error instanceof OperationTimeoutError) {
    return { error: "OPERATION_TIMEOUT" };
  }

  if (
    error instanceof HostSourceUnavailableError ||
    error instanceof DockerSourceUnavailableError ||
    error instanceof SystemdSourceUnavailableError ||
    error instanceof LogSourceUnavailableError ||
    error instanceof BackupSourceUnavailableError ||
    error instanceof MaintenanceSourceUnavailableError ||
    error instanceof DeploySourceUnavailableError
  ) {
    return { error: "SOURCE_UNAVAILABLE" };
  }

  return { error: "INTERNAL_ERROR" };
}
