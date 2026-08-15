import {
  parseMaintenanceEventsSnapshot,
  type MaintenanceEventsSnapshot,
} from "@dashboard-rpi5/contracts/maintenance";
import { request } from "node:http";
import { isAbsolute } from "node:path";

export const DEFAULT_AGENT_SOCKET_PATH = "/run/dashboard-rpi5/agent.sock";
export const AGENT_MAINTENANCE_EVENTS_PATH = "/v1/maintenance/events/recent";
export const AGENT_MAINTENANCE_EVENTS_TIMEOUT_MS = 1_500;
export const AGENT_MAINTENANCE_EVENTS_MAX_BYTES = 128 * 1024;

export type MaintenanceEventsReader = () => Promise<MaintenanceEventsSnapshot>;

interface AgentMaintenanceEventsClientOptions {
  socketPath?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export class AgentMaintenanceEventsSourceError extends Error {
  constructor() {
    super("Agent maintenance events source unavailable");
    this.name = "AgentMaintenanceEventsSourceError";
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

async function readMaintenanceEventsFromAgent(
  socketPath: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<MaintenanceEventsSnapshot> {
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
        path: AGENT_MAINTENANCE_EVENTS_PATH,
        method: "GET",
        headers: { Accept: "application/json" },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          finish(() => reject(new AgentMaintenanceEventsSourceError()));
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
            finish(() => reject(new AgentMaintenanceEventsSourceError()));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          if (settled) return;
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
            const snapshot = parseMaintenanceEventsSnapshot(parsed);
            finish(() => resolve(snapshot));
          } catch {
            finish(() => reject(new AgentMaintenanceEventsSourceError()));
          }
        });
        response.on("error", () =>
          finish(() => reject(new AgentMaintenanceEventsSourceError())),
        );
      },
    );

    const deadline = setTimeout(() => {
      req.destroy();
      finish(() => reject(new AgentMaintenanceEventsSourceError()));
    }, timeoutMs);
    deadline.unref();
    req.on("error", () => finish(() => reject(new AgentMaintenanceEventsSourceError())));
    req.end();
  });
}

export function createAgentMaintenanceEventsReader(
  options: AgentMaintenanceEventsClientOptions = {},
): MaintenanceEventsReader {
  const socketPath = validateSocketPath(options.socketPath ?? DEFAULT_AGENT_SOCKET_PATH);
  const timeoutMs = validateBound(
    options.timeoutMs ?? AGENT_MAINTENANCE_EVENTS_TIMEOUT_MS,
    10,
    5_000,
    "timeoutMs",
  );
  const maxBytes = validateBound(
    options.maxBytes ?? AGENT_MAINTENANCE_EVENTS_MAX_BYTES,
    1_024,
    256 * 1024,
    "maxBytes",
  );

  return () => readMaintenanceEventsFromAgent(socketPath, timeoutMs, maxBytes);
}
