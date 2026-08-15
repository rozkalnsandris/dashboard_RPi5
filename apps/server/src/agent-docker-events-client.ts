import type {
  DockerEventAction,
  DockerEventHealth,
  DockerEventScope,
  DockerRecentEvent,
  DockerRecentEventsSnapshot,
} from "@dashboard-rpi5/contracts";
import { request } from "node:http";
import { isAbsolute } from "node:path";

export const DEFAULT_AGENT_SOCKET_PATH = "/run/dashboard-rpi5/agent.sock";
export const AGENT_DOCKER_EVENTS_PATH = "/v1/docker/events/recent";
export const AGENT_DOCKER_EVENTS_TIMEOUT_MS = 1_500;
export const AGENT_DOCKER_EVENTS_MAX_BYTES = 256 * 1024;

export type DockerEventsReader = () => Promise<DockerRecentEventsSnapshot>;

interface AgentDockerEventsClientOptions {
  socketPath?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export class AgentDockerEventsSourceError extends Error {
  constructor() {
    super("Agent Docker events source unavailable");
    this.name = "AgentDockerEventsSourceError";
  }
}

const ACTIONS = new Set<DockerEventAction>([
  "CREATE",
  "DESTROY",
  "DIE",
  "HEALTH_STATUS",
  "KILL",
  "OOM",
  "PAUSE",
  "RENAME",
  "RESTART",
  "START",
  "STOP",
  "UNPAUSE",
  "UPDATE",
]);
const HEALTH_STATES = new Set<DockerEventHealth>([
  "HEALTHY",
  "UNHEALTHY",
  "STARTING",
  "UNKNOWN",
]);
const SCOPES = new Set<DockerEventScope>(["LOCAL", "SWARM", "UNKNOWN"]);
const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseNullableString(value: unknown, maxLength: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new AgentDockerEventsSourceError();
  }
  return value;
}

function parseEvent(value: unknown): DockerRecentEvent {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "occurredAt",
      "action",
      "containerId",
      "containerName",
      "image",
      "health",
      "exitCode",
      "signal",
      "scope",
    ]) ||
    !isIsoDate(value.occurredAt) ||
    typeof value.action !== "string" ||
    !ACTIONS.has(value.action as DockerEventAction) ||
    typeof value.containerId !== "string" ||
    !CONTAINER_ID_PATTERN.test(value.containerId) ||
    typeof value.scope !== "string" ||
    !SCOPES.has(value.scope as DockerEventScope)
  ) {
    throw new AgentDockerEventsSourceError();
  }

  const containerName = parseNullableString(value.containerName, 256);
  const image = parseNullableString(value.image, 1_024);
  const signal = parseNullableString(value.signal, 32);

  if (
    value.health !== null &&
    (typeof value.health !== "string" || !HEALTH_STATES.has(value.health as DockerEventHealth))
  ) {
    throw new AgentDockerEventsSourceError();
  }
  if (
    value.exitCode !== null &&
    (typeof value.exitCode !== "number" ||
      !Number.isSafeInteger(value.exitCode) ||
      value.exitCode < 0 ||
      value.exitCode > 255)
  ) {
    throw new AgentDockerEventsSourceError();
  }

  return {
    occurredAt: value.occurredAt,
    action: value.action as DockerEventAction,
    containerId: value.containerId,
    containerName,
    image,
    health: value.health as DockerEventHealth | null,
    exitCode: value.exitCode as number | null,
    signal,
    scope: value.scope as DockerEventScope,
  };
}

export function parseDockerRecentEventsSnapshot(value: unknown): DockerRecentEventsSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["observedAt", "windowStart", "windowEnd", "apiVersion", "events"]) ||
    !isIsoDate(value.observedAt) ||
    !isIsoDate(value.windowStart) ||
    !isIsoDate(value.windowEnd) ||
    value.apiVersion !== "1.40" ||
    !Array.isArray(value.events) ||
    value.events.length > 256
  ) {
    throw new AgentDockerEventsSourceError();
  }

  if (Date.parse(value.windowStart) > Date.parse(value.windowEnd)) {
    throw new AgentDockerEventsSourceError();
  }

  const events = value.events.map(parseEvent);
  for (const event of events) {
    const occurred = Date.parse(event.occurredAt);
    if (occurred < Date.parse(value.windowStart) - 1_000 || occurred > Date.parse(value.windowEnd) + 1_000) {
      throw new AgentDockerEventsSourceError();
    }
  }

  return {
    observedAt: value.observedAt,
    windowStart: value.windowStart,
    windowEnd: value.windowEnd,
    apiVersion: "1.40",
    events,
  };
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

async function readDockerEventsFromAgent(
  socketPath: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<DockerRecentEventsSnapshot> {
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
        path: AGENT_DOCKER_EVENTS_PATH,
        method: "GET",
        headers: { Accept: "application/json" },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          finish(() => reject(new AgentDockerEventsSourceError()));
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
            finish(() => reject(new AgentDockerEventsSourceError()));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          if (settled) return;
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
            const snapshot = parseDockerRecentEventsSnapshot(parsed);
            finish(() => resolve(snapshot));
          } catch {
            finish(() => reject(new AgentDockerEventsSourceError()));
          }
        });
        response.on("error", () =>
          finish(() => reject(new AgentDockerEventsSourceError())),
        );
      },
    );

    const deadline = setTimeout(() => {
      req.destroy();
      finish(() => reject(new AgentDockerEventsSourceError()));
    }, timeoutMs);
    deadline.unref();
    req.on("error", () => finish(() => reject(new AgentDockerEventsSourceError())));
    req.end();
  });
}

export function createAgentDockerEventsReader(
  options: AgentDockerEventsClientOptions = {},
): DockerEventsReader {
  const socketPath = validateSocketPath(options.socketPath ?? DEFAULT_AGENT_SOCKET_PATH);
  const timeoutMs = validateBound(
    options.timeoutMs ?? AGENT_DOCKER_EVENTS_TIMEOUT_MS,
    10,
    5_000,
    "timeoutMs",
  );
  const maxBytes = validateBound(
    options.maxBytes ?? AGENT_DOCKER_EVENTS_MAX_BYTES,
    1_024,
    512 * 1024,
    "maxBytes",
  );

  return () => readDockerEventsFromAgent(socketPath, timeoutMs, maxBytes);
}
