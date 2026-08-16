import type {
  QuickCommandCatalog,
  QuickCommandId,
  QuickCommandResult,
} from "@dashboard-rpi5/contracts/quick-commands";
import { request } from "node:http";
import { isAbsolute } from "node:path";

export const AGENT_QUICK_COMMANDS_PATH = "/v1/quick-commands";
export const AGENT_QUICK_COMMAND_RUN_PATH = "/v1/quick-commands/run";
const DEFAULT_SOCKET_PATH = "/run/dashboard-rpi5/agent.sock";
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_MAX_BYTES = 48 * 1024;
const VALID_IDS = new Set<QuickCommandId>([
  "host.uptime",
  "host.kernel",
  "host.disk-root",
  "host.failed-units",
]);

export type QuickCommandCatalogReader = () => Promise<QuickCommandCatalog>;
export type QuickCommandRunner = (commandId: QuickCommandId) => Promise<QuickCommandResult>;

interface Options {
  socketPath?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export class AgentQuickCommandSourceError extends Error {
  constructor() {
    super("Agent quick command source unavailable");
    this.name = "AgentQuickCommandSourceError";
  }
}

export class AgentQuickCommandTimeoutError extends Error {
  constructor() {
    super("Agent quick command timed out");
    this.name = "AgentQuickCommandTimeoutError";
  }
}

function validateSocketPath(socketPath: string) {
  if (!isAbsolute(socketPath) || socketPath.includes("\0") || Buffer.byteLength(socketPath) > 100) {
    throw new TypeError("Invalid agent socket path");
  }
  return socketPath;
}

function validateBound(value: number, min: number, max: number, label: string) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} outside allowed range`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseId(value: unknown): QuickCommandId {
  if (typeof value !== "string" || !VALID_IDS.has(value as QuickCommandId)) {
    throw new AgentQuickCommandSourceError();
  }
  return value as QuickCommandId;
}

function parseCatalog(value: unknown): QuickCommandCatalog {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "commands") || !Array.isArray(value.commands) || value.commands.length < 1 || value.commands.length > 4) {
    throw new AgentQuickCommandSourceError();
  }
  const seen = new Set<QuickCommandId>();
  const commands = value.commands.map((item) => {
    if (!isRecord(item) || Object.keys(item).some((key) => !["id", "label", "description"].includes(key)) || typeof item.label !== "string" || item.label.length < 1 || item.label.length > 48 || typeof item.description !== "string" || item.description.length < 1 || item.description.length > 120) {
      throw new AgentQuickCommandSourceError();
    }
    const id = parseId(item.id);
    if (seen.has(id)) throw new AgentQuickCommandSourceError();
    seen.add(id);
    return { id, label: item.label, description: item.description };
  });
  return { commands };
}

function parseResult(value: unknown): QuickCommandResult {
  if (!isRecord(value) || Object.keys(value).some((key) => !["commandId", "status", "startedAt", "finishedAt", "durationMs", "exitCode", "stdout", "stderr"].includes(key)) || (value.status !== "SUCCESS" && value.status !== "FAILED") || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt)) || typeof value.finishedAt !== "string" || !Number.isFinite(Date.parse(value.finishedAt)) || typeof value.durationMs !== "number" || !Number.isSafeInteger(value.durationMs) || value.durationMs < 0 || value.durationMs > 30_000 || (value.exitCode !== null && (typeof value.exitCode !== "number" || !Number.isSafeInteger(value.exitCode) || value.exitCode < 0 || value.exitCode > 255)) || typeof value.stdout !== "string" || value.stdout.length > 16_384 || typeof value.stderr !== "string" || value.stderr.length > 16_384) {
    throw new AgentQuickCommandSourceError();
  }
  const startedAt = new Date(value.startedAt).toISOString();
  const finishedAt = new Date(value.finishedAt).toISOString();
  if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new AgentQuickCommandSourceError();
  return {
    commandId: parseId(value.commandId),
    status: value.status,
    startedAt,
    finishedAt,
    durationMs: value.durationMs,
    exitCode: value.exitCode as number | null,
    stdout: value.stdout,
    stderr: value.stderr,
  };
}

async function requestJson(socketPath: string, timeoutMs: number, maxBytes: number, method: "GET" | "POST", path: string, body?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback();
    };
    const req = request({
      socketPath,
      path,
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }),
      },
    }, (response) => {
      if (response.statusCode === 504) {
        response.resume();
        finish(() => reject(new AgentQuickCommandTimeoutError()));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        finish(() => reject(new AgentQuickCommandSourceError()));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > maxBytes) {
          response.destroy();
          finish(() => reject(new AgentQuickCommandSourceError()));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        if (settled) return;
        try {
          finish(() => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown));
        } catch {
          finish(() => reject(new AgentQuickCommandSourceError()));
        }
      });
      response.on("error", () => finish(() => reject(new AgentQuickCommandSourceError())));
    });
    const deadline = setTimeout(() => {
      req.destroy();
      finish(() => reject(new AgentQuickCommandTimeoutError()));
    }, timeoutMs);
    deadline.unref();
    req.on("error", () => finish(() => reject(new AgentQuickCommandSourceError())));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export function createAgentQuickCommandReaders(options: Options = {}): { readCatalog: QuickCommandCatalogReader; runCommand: QuickCommandRunner } {
  const socketPath = validateSocketPath(options.socketPath ?? DEFAULT_SOCKET_PATH);
  const timeoutMs = validateBound(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 100, 10_000, "timeoutMs");
  const maxBytes = validateBound(options.maxBytes ?? DEFAULT_MAX_BYTES, 1_024, 128 * 1024, "maxBytes");
  return {
    readCatalog: async () => parseCatalog(await requestJson(socketPath, timeoutMs, maxBytes, "GET", AGENT_QUICK_COMMANDS_PATH)),
    runCommand: async (commandId) => parseResult(await requestJson(socketPath, timeoutMs, maxBytes, "POST", AGENT_QUICK_COMMAND_RUN_PATH, JSON.stringify({ commandId }))),
  };
}
