import {
  parseDeployEventsSnapshot,
  type DeployEventsSnapshot,
} from "@dashboard-rpi5/contracts/deploy";
import { request } from "node:http";
import { isAbsolute } from "node:path";

export const DEFAULT_AGENT_SOCKET_PATH = "/run/dashboard-rpi5/agent.sock";
export const AGENT_DEPLOY_EVENTS_PATH = "/v1/deploy/events/recent";
export const AGENT_DEPLOY_EVENTS_TIMEOUT_MS = 1_500;
export const AGENT_DEPLOY_EVENTS_MAX_BYTES = 128 * 1024;

export type DeployEventsReader = () => Promise<DeployEventsSnapshot>;

interface AgentDeployEventsClientOptions {
  socketPath?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export class AgentDeployEventsSourceError extends Error {
  constructor() {
    super("Agent deploy events source unavailable");
    this.name = "AgentDeployEventsSourceError";
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

async function readDeployEventsFromAgent(
  socketPath: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<DeployEventsSnapshot> {
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
        path: AGENT_DEPLOY_EVENTS_PATH,
        method: "GET",
        headers: { Accept: "application/json" },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          finish(() => reject(new AgentDeployEventsSourceError()));
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
            finish(() => reject(new AgentDeployEventsSourceError()));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          if (settled) return;
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
            const snapshot = parseDeployEventsSnapshot(parsed);
            finish(() => resolve(snapshot));
          } catch {
            finish(() => reject(new AgentDeployEventsSourceError()));
          }
        });
        response.on("error", () => finish(() => reject(new AgentDeployEventsSourceError())));
      },
    );

    const deadline = setTimeout(() => {
      req.destroy();
      finish(() => reject(new AgentDeployEventsSourceError()));
    }, timeoutMs);
    deadline.unref();
    req.on("error", () => finish(() => reject(new AgentDeployEventsSourceError())));
    req.end();
  });
}

export function createAgentDeployEventsReader(
  options: AgentDeployEventsClientOptions = {},
): DeployEventsReader {
  const socketPath = validateSocketPath(options.socketPath ?? DEFAULT_AGENT_SOCKET_PATH);
  const timeoutMs = validateBound(
    options.timeoutMs ?? AGENT_DEPLOY_EVENTS_TIMEOUT_MS,
    10,
    5_000,
    "timeoutMs",
  );
  const maxBytes = validateBound(
    options.maxBytes ?? AGENT_DEPLOY_EVENTS_MAX_BYTES,
    1_024,
    256 * 1024,
    "maxBytes",
  );
  return () => readDeployEventsFromAgent(socketPath, timeoutMs, maxBytes);
}
