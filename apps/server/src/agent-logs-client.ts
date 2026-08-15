import {
  parseLogSnapshot,
  parseLogSourcesSnapshot,
  type LogRange,
  type LogSnapshot,
  type LogSourceId,
  type LogSourcesSnapshot,
} from "@dashboard-rpi5/contracts/logs";
import { request } from "node:http";
import { isAbsolute } from "node:path";

export const DEFAULT_LOGS_AGENT_SOCKET_PATH = "/run/dashboard-rpi5/agent.sock";
export const AGENT_LOG_SOURCES_PATH = "/v1/logs/sources";
export const AGENT_LOGS_PATH = "/v1/logs";
export const AGENT_LOGS_TIMEOUT_MS = 2_000;
export const AGENT_LOGS_MAX_BYTES = 768 * 1024;

export type LogSourcesReader = () => Promise<LogSourcesSnapshot>;
export type LogsReader = (sourceId: LogSourceId, range: LogRange) => Promise<LogSnapshot>;

interface AgentLogsClientOptions {
  socketPath?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export class AgentLogsSourceError extends Error {
  constructor() {
    super("Agent logs source unavailable");
    this.name = "AgentLogsSourceError";
  }
}

function validateSocketPath(socketPath: string): string {
  if (
    !isAbsolute(socketPath) ||
    socketPath.includes("\0") ||
    Buffer.byteLength(socketPath, "utf8") > 100
  ) {
    throw new TypeError("Invalid agent socket path");
  }
  return socketPath;
}

function validateBound(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} outside allowed range`);
  }
  return value;
}

async function requestAgentJson(
  socketPath: string,
  path: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback();
    };

    const req = request(
      {
        socketPath,
        path,
        method: "GET",
        headers: { Accept: "application/json" },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          finish(() => reject(new AgentLogsSourceError()));
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        response.on("data", (chunk: Buffer | string) => {
          if (settled) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.length;
          if (totalBytes > maxBytes) {
            response.destroy();
            finish(() => reject(new AgentLogsSourceError()));
            return;
          }
          chunks.push(buffer);
        });
        response.once("error", () => finish(() => reject(new AgentLogsSourceError())));
        response.once("end", () => {
          if (settled) return;
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
            finish(() => resolve(value));
          } catch {
            finish(() => reject(new AgentLogsSourceError()));
          }
        });
      },
    );

    const deadline = setTimeout(() => {
      req.destroy();
      finish(() => reject(new AgentLogsSourceError()));
    }, timeoutMs);
    deadline.unref();
    req.once("error", () => finish(() => reject(new AgentLogsSourceError())));
    req.end();
  });
}

export function createAgentLogsReaders(options: AgentLogsClientOptions = {}): {
  readSources: LogSourcesReader;
  readLogs: LogsReader;
} {
  const socketPath = validateSocketPath(options.socketPath ?? DEFAULT_LOGS_AGENT_SOCKET_PATH);
  const timeoutMs = validateBound(options.timeoutMs ?? AGENT_LOGS_TIMEOUT_MS, 10, 5_000, "timeoutMs");
  const maxBytes = validateBound(
    options.maxBytes ?? AGENT_LOGS_MAX_BYTES,
    1_024,
    2 * 1024 * 1024,
    "maxBytes",
  );

  return {
    async readSources() {
      const value = await requestAgentJson(
        socketPath,
        AGENT_LOG_SOURCES_PATH,
        timeoutMs,
        maxBytes,
      );
      try {
        return parseLogSourcesSnapshot(value);
      } catch {
        throw new AgentLogsSourceError();
      }
    },
    async readLogs(sourceId, range) {
      const query = new URLSearchParams({ sourceId, range }).toString();
      const value = await requestAgentJson(
        socketPath,
        `${AGENT_LOGS_PATH}?${query}`,
        timeoutMs,
        maxBytes,
      );
      try {
        return parseLogSnapshot(value);
      } catch {
        throw new AgentLogsSourceError();
      }
    },
  };
}
