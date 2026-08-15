import type {
  DockerEventAction,
  DockerEventHealth,
  DockerEventScope,
  DockerRecentEvent,
  DockerRecentEventsSnapshot,
} from "@dashboard-rpi5/contracts";
import { request } from "node:http";
import { StringDecoder } from "node:string_decoder";

import {
  DOCKER_API_PREFIX,
  DOCKER_API_VERSION,
  DOCKER_MAX_RESPONSE_BYTES,
  DOCKER_SOCKET_PATH,
  DockerSourceUnavailableError,
} from "./docker-read.js";

export const DOCKER_EVENTS_LOOKBACK_SECONDS = 60 * 60;
export const DOCKER_EVENTS_MAX_ITEMS = 256;
export const DOCKER_EVENTS_REQUEST_TIMEOUT_MS = 2_500;

export const DOCKER_EVENT_FILTER_ACTIONS = Object.freeze([
  "create",
  "destroy",
  "die",
  "health_status",
  "kill",
  "oom",
  "pause",
  "rename",
  "restart",
  "start",
  "stop",
  "unpause",
  "update",
] as const);

const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/;
const SIGNAL_PATTERN = /^(?:SIG[A-Z0-9]+|[0-9]{1,3})$/;

const ACTION_MAP: Readonly<Record<string, DockerEventAction>> = Object.freeze({
  create: "CREATE",
  destroy: "DESTROY",
  die: "DIE",
  health_status: "HEALTH_STATUS",
  kill: "KILL",
  oom: "OOM",
  pause: "PAUSE",
  rename: "RENAME",
  restart: "RESTART",
  start: "START",
  stop: "STOP",
  unpause: "UNPAUSE",
  update: "UPDATE",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new DockerSourceUnavailableError();
  return value;
}

function parseFilterShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (Object.keys(value).sort().join(",") !== "event,type") return false;

  const types = value.type;
  const events = value.event;
  if (!Array.isArray(types) || types.length !== 1 || types[0] !== "container") return false;
  if (!Array.isArray(events) || events.length !== DOCKER_EVENT_FILTER_ACTIONS.length) return false;

  return events.every((entry, index) => entry === DOCKER_EVENT_FILTER_ACTIONS[index]);
}

export function buildDockerEventsPath(sinceEpochSeconds: number, untilEpochSeconds: number) {
  if (
    !Number.isSafeInteger(sinceEpochSeconds) ||
    !Number.isSafeInteger(untilEpochSeconds) ||
    sinceEpochSeconds < 0 ||
    untilEpochSeconds < sinceEpochSeconds
  ) {
    throw new DockerSourceUnavailableError();
  }

  const filters = JSON.stringify({
    type: ["container"],
    event: [...DOCKER_EVENT_FILTER_ACTIONS],
  });

  return `${DOCKER_API_PREFIX}/events?since=${sinceEpochSeconds}&until=${untilEpochSeconds}&filters=${encodeURIComponent(filters)}`;
}

export function isAllowedDockerEventsPath(path: string): boolean {
  try {
    const url = new URL(path, "http://docker.local");
    if (url.origin !== "http://docker.local" || url.pathname !== `${DOCKER_API_PREFIX}/events`) {
      return false;
    }

    const keys = [...url.searchParams.keys()].sort();
    if (keys.join(",") !== "filters,since,until") return false;
    if (
      url.searchParams.getAll("filters").length !== 1 ||
      url.searchParams.getAll("since").length !== 1 ||
      url.searchParams.getAll("until").length !== 1
    ) {
      return false;
    }

    const sinceRaw = url.searchParams.get("since") ?? "";
    const untilRaw = url.searchParams.get("until") ?? "";
    if (!/^\d+$/.test(sinceRaw) || !/^\d+$/.test(untilRaw)) return false;

    const since = Number(sinceRaw);
    const until = Number(untilRaw);
    if (!Number.isSafeInteger(since) || !Number.isSafeInteger(until) || until < since) return false;

    const filterRaw = url.searchParams.get("filters");
    if (filterRaw === null) return false;
    return parseFilterShape(JSON.parse(filterRaw) as unknown);
  } catch {
    return false;
  }
}

export class DockerEventStreamDecoder {
  readonly #decoder = new StringDecoder("utf8");
  readonly #values: unknown[] = [];
  #pending = "";
  #totalBytes = 0;

  push(chunk: Buffer | string) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    this.#totalBytes += buffer.byteLength;
    if (this.#totalBytes > DOCKER_MAX_RESPONSE_BYTES) {
      throw new DockerSourceUnavailableError();
    }

    this.#pending += this.#decoder.write(buffer);
    this.#drainLines();
  }

  finish(): unknown[] {
    this.#pending += this.#decoder.end();
    this.#drainLines();

    const tail = this.#pending.trim();
    this.#pending = "";
    if (tail.length > 0) this.#parseLine(tail);

    return [...this.#values];
  }

  #drainLines() {
    let newlineIndex = this.#pending.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.#pending.slice(0, newlineIndex).trim();
      this.#pending = this.#pending.slice(newlineIndex + 1);
      if (line.length > 0) this.#parseLine(line);
      newlineIndex = this.#pending.indexOf("\n");
    }
  }

  #parseLine(line: string) {
    try {
      this.#values.push(JSON.parse(line) as unknown);
    } catch {
      throw new DockerSourceUnavailableError();
    }
  }
}

export interface DockerEventsTransport {
  read(path: string, signal?: AbortSignal): Promise<unknown[]>;
}

export function createDockerEventsUnixTransport(): DockerEventsTransport {
  return {
    async read(path: string, signal?: AbortSignal): Promise<unknown[]> {
      if (!isAllowedDockerEventsPath(path)) throw new DockerSourceUnavailableError();

      return new Promise<unknown[]>((resolve, reject) => {
        const decoder = new DockerEventStreamDecoder();
        let settled = false;

        const fail = (error: unknown) => {
          if (settled) return;
          settled = true;
          reject(
            error instanceof DockerSourceUnavailableError
              ? error
              : new DockerSourceUnavailableError(),
          );
        };

        const succeed = (value: unknown[]) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };

        const req = request(
          {
            socketPath: DOCKER_SOCKET_PATH,
            path,
            method: "GET",
            headers: { accept: "application/json" },
            ...(signal === undefined ? {} : { signal }),
          },
          (response) => {
            const statusCode = response.statusCode ?? 0;
            if (statusCode < 200 || statusCode >= 300) {
              response.resume();
              fail(new DockerSourceUnavailableError());
              return;
            }

            response.on("data", (chunk: Buffer) => {
              try {
                decoder.push(chunk);
              } catch (error: unknown) {
                const normalizedError =
                  error instanceof DockerSourceUnavailableError
                    ? error
                    : new DockerSourceUnavailableError();
                fail(normalizedError);
                req.destroy(normalizedError);
              }
            });
            response.once("error", fail);
            response.once("end", () => {
              try {
                succeed(decoder.finish());
              } catch (error: unknown) {
                fail(error);
              }
            });
          },
        );

        req.setTimeout(DOCKER_EVENTS_REQUEST_TIMEOUT_MS, () => {
          const timeoutError = new DockerSourceUnavailableError();
          fail(timeoutError);
          req.destroy(timeoutError);
        });
        req.once("error", fail);
        req.end();
      });
    },
  };
}

function optionalAttribute(
  attributes: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  const value = attributes[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new DockerSourceUnavailableError();
  }
  return value;
}

function parseHealth(rawAction: string, attributes: Record<string, unknown>): DockerEventHealth {
  const suffix = rawAction.includes(":") ? rawAction.slice(rawAction.indexOf(":") + 1).trim() : "";
  const attribute = typeof attributes.health_status === "string" ? attributes.health_status : "";
  const value = (suffix || attribute).toLowerCase();

  if (value === "healthy") return "HEALTHY";
  if (value === "unhealthy") return "UNHEALTHY";
  if (value === "starting") return "STARTING";
  return "UNKNOWN";
}

function normalizeAction(raw: unknown): { action: DockerEventAction; healthAction: boolean } | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 128) {
    throw new DockerSourceUnavailableError();
  }

  const lower = raw.toLowerCase();
  const base = lower.startsWith("health_status") ? "health_status" : lower;
  const action = ACTION_MAP[base];
  return action === undefined ? null : { action, healthAction: base === "health_status" };
}

function parseOccurredAt(record: Record<string, unknown>): string {
  const timeNano = record.timeNano;
  if (typeof timeNano === "number" && Number.isSafeInteger(timeNano) && timeNano >= 0) {
    return new Date(Math.floor(timeNano / 1_000_000)).toISOString();
  }

  const time = record.time;
  if (typeof time !== "number" || !Number.isSafeInteger(time) || time < 0) {
    throw new DockerSourceUnavailableError();
  }

  return new Date(time * 1_000).toISOString();
}

function parseExitCode(attributes: Record<string, unknown>): number | null {
  const value = attributes.exitCode;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^\d{1,3}$/.test(value)) {
    throw new DockerSourceUnavailableError();
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 255) {
    throw new DockerSourceUnavailableError();
  }
  return parsed;
}

function parseSignal(attributes: Record<string, unknown>): string | null {
  const value = attributes.signal;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !SIGNAL_PATTERN.test(value) || value.length > 32) {
    throw new DockerSourceUnavailableError();
  }
  return value;
}

function normalizeScope(value: unknown): DockerEventScope {
  if (value === "local") return "LOCAL";
  if (value === "swarm") return "SWARM";
  return "UNKNOWN";
}

export function normalizeDockerEvent(value: unknown): DockerRecentEvent | null {
  const record = requireRecord(value);
  if (record.Type !== "container") return null;

  const normalizedAction = normalizeAction(record.Action ?? record.status);
  if (normalizedAction === null) return null;

  const actor = requireRecord(record.Actor);
  const rawId = actor.ID ?? record.id;
  if (typeof rawId !== "string") throw new DockerSourceUnavailableError();
  const containerId = rawId.toLowerCase();
  if (!CONTAINER_ID_PATTERN.test(containerId)) throw new DockerSourceUnavailableError();

  const attributes = isRecord(actor.Attributes) ? actor.Attributes : {};

  return {
    occurredAt: parseOccurredAt(record),
    action: normalizedAction.action,
    containerId,
    containerName: optionalAttribute(attributes, "name", 256),
    image: optionalAttribute(attributes, "image", 1024),
    health: normalizedAction.healthAction ? parseHealth(String(record.Action ?? record.status), attributes) : null,
    exitCode: normalizedAction.action === "DIE" ? parseExitCode(attributes) : null,
    signal: normalizedAction.action === "KILL" ? parseSignal(attributes) : null,
    scope: normalizeScope(record.scope),
  };
}

function eventIdentity(event: DockerRecentEvent): string {
  return JSON.stringify(event);
}

export async function readRecentDockerEvents(
  transport: DockerEventsTransport = createDockerEventsUnixTransport(),
  signal?: AbortSignal,
  now: () => Date = () => new Date(),
): Promise<DockerRecentEventsSnapshot> {
  try {
    signal?.throwIfAborted();

    const observedAt = now();
    if (!Number.isFinite(observedAt.getTime())) throw new DockerSourceUnavailableError();

    const untilEpochSeconds = Math.floor(observedAt.getTime() / 1_000);
    const sinceEpochSeconds = Math.max(0, untilEpochSeconds - DOCKER_EVENTS_LOOKBACK_SECONDS);
    const path = buildDockerEventsPath(sinceEpochSeconds, untilEpochSeconds);
    const rawEvents = await transport.read(path, signal);

    const unique = new Map<string, DockerRecentEvent>();
    for (const rawEvent of rawEvents) {
      const event = normalizeDockerEvent(rawEvent);
      if (event === null) continue;
      unique.set(eventIdentity(event), event);
    }

    const events = [...unique.values()]
      .sort((left, right) => {
        const byTime = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
        if (byTime !== 0) return byTime;
        const byId = left.containerId.localeCompare(right.containerId);
        return byId !== 0 ? byId : left.action.localeCompare(right.action);
      })
      .slice(0, DOCKER_EVENTS_MAX_ITEMS);

    signal?.throwIfAborted();

    return {
      observedAt: observedAt.toISOString(),
      windowStart: new Date(sinceEpochSeconds * 1_000).toISOString(),
      windowEnd: new Date(untilEpochSeconds * 1_000).toISOString(),
      apiVersion: DOCKER_API_VERSION,
      events,
    };
  } catch (error: unknown) {
    if (error instanceof DockerSourceUnavailableError) throw error;
    throw new DockerSourceUnavailableError();
  }
}
