import {
  parseDockerContainersSnapshot,
  parseHostSummary,
} from "@dashboard-rpi5/contracts/current-state";
import type {
  DockerContainersSnapshot,
  HostSummary,
} from "@dashboard-rpi5/contracts";
import { request } from "node:http";
import { isAbsolute } from "node:path";

export const DEFAULT_AGENT_SOCKET_PATH = "/run/dashboard-rpi5/agent.sock";
export const AGENT_HOST_SUMMARY_PATH = "/v1/host/summary";
export const AGENT_DOCKER_CONTAINERS_PATH = "/v1/docker/containers";
export const AGENT_CURRENT_STATE_TIMEOUT_MS = 1_500;
export const AGENT_HOST_SUMMARY_MAX_BYTES = 64 * 1024;
export const AGENT_DOCKER_CONTAINERS_MAX_BYTES = 2 * 1024 * 1024;

export type HostSummaryReader = () => Promise<HostSummary>;
export type DockerContainersReader = () => Promise<DockerContainersSnapshot>;

interface AgentCurrentStateClientOptions {
  socketPath?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export class AgentCurrentStateSourceError extends Error {
  constructor() {
    super("Agent current-state source unavailable");
    this.name = "AgentCurrentStateSourceError";
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

async function readSnapshotFromAgent<T>(
  socketPath: string,
  path: string,
  timeoutMs: number,
  maxBytes: number,
  parse: (value: unknown) => T,
): Promise<T> {
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
          finish(() => reject(new AgentCurrentStateSourceError()));
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
            finish(() => reject(new AgentCurrentStateSourceError()));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          if (settled) return;
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
            const snapshot = parse(parsed);
            finish(() => resolve(snapshot));
          } catch {
            finish(() => reject(new AgentCurrentStateSourceError()));
          }
        });
        response.on("error", () => finish(() => reject(new AgentCurrentStateSourceError())));
      },
    );

    const deadline = setTimeout(() => {
      req.destroy();
      finish(() => reject(new AgentCurrentStateSourceError()));
    }, timeoutMs);
    deadline.unref();
    req.on("error", () => finish(() => reject(new AgentCurrentStateSourceError())));
    req.end();
  });
}

export function createAgentHostSummaryReader(
  options: AgentCurrentStateClientOptions = {},
): HostSummaryReader {
  const socketPath = validateSocketPath(options.socketPath ?? DEFAULT_AGENT_SOCKET_PATH);
  const timeoutMs = validateBound(
    options.timeoutMs ?? AGENT_CURRENT_STATE_TIMEOUT_MS,
    10,
    5_000,
    "timeoutMs",
  );
  const maxBytes = validateBound(
    options.maxBytes ?? AGENT_HOST_SUMMARY_MAX_BYTES,
    1_024,
    256 * 1024,
    "maxBytes",
  );
  return () => readSnapshotFromAgent(socketPath, AGENT_HOST_SUMMARY_PATH, timeoutMs, maxBytes, parseHostSummary);
}

export function createAgentDockerContainersReader(
  options: AgentCurrentStateClientOptions = {},
): DockerContainersReader {
  const socketPath = validateSocketPath(options.socketPath ?? DEFAULT_AGENT_SOCKET_PATH);
  const timeoutMs = validateBound(
    options.timeoutMs ?? AGENT_CURRENT_STATE_TIMEOUT_MS,
    10,
    5_000,
    "timeoutMs",
  );
  const maxBytes = validateBound(
    options.maxBytes ?? AGENT_DOCKER_CONTAINERS_MAX_BYTES,
    1_024,
    4 * 1024 * 1024,
    "maxBytes",
  );
  return () => readSnapshotFromAgent(
    socketPath,
    AGENT_DOCKER_CONTAINERS_PATH,
    timeoutMs,
    maxBytes,
    parseDockerContainersSnapshot,
  );
}
