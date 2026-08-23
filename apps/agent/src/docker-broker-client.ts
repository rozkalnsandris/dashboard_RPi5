import { request } from "node:http";

import { DOCKER_MAX_RESPONSE_BYTES, isDockerContainerId } from "./docker-api.js";
import {
  DEFAULT_DOCKER_BROKER_SOCKET_PATH,
  DOCKER_BROKER_CONTAINERS_PATH,
  DOCKER_BROKER_EVENTS_MAX_ITEMS,
  DOCKER_BROKER_LOG_MAX_RESPONSE_BYTES,
  DOCKER_BROKER_PING_PATH,
  DOCKER_BROKER_SOCKET_ENV,
  DOCKER_BROKER_VERSION_PATH,
  dockerBrokerEventsPath,
  dockerBrokerInspectPath,
  dockerBrokerLogsPath,
  dockerBrokerStatsPath,
  type DockerBrokerLogRange,
  type DockerBrokerLogSource,
} from "./docker-broker-protocol.js";

// Keep the outer broker budget above the bounded Engine read so the broker
// does not abort a valid two-cycle Docker stats response first.
export const DOCKER_BROKER_REQUEST_TIMEOUT_MS = 3_500;

export class DockerBrokerRequestError extends Error {
  constructor(readonly statusCode: number | null = null) {
    super("Docker broker evidence is unavailable");
    this.name = "DockerBrokerRequestError";
  }
}

export interface DockerBrokerTransport {
  ping(signal?: AbortSignal): Promise<void>;
  version(signal?: AbortSignal): Promise<unknown>;
  listContainers(signal?: AbortSignal): Promise<unknown>;
  inspectContainer(id: string, signal?: AbortSignal): Promise<unknown>;
  statsContainer(id: string, signal?: AbortSignal): Promise<unknown>;
}

export interface DockerBrokerLogTransport {
  readLogs(
    source: DockerBrokerLogSource,
    range: DockerBrokerLogRange,
    signal?: AbortSignal,
  ): Promise<Buffer>;
}

export interface DockerBrokerEventTransport {
  readEvents(since: number, until: number, signal?: AbortSignal): Promise<unknown[]>;
}

export type DockerBrokerFullTransport = DockerBrokerTransport &
  DockerBrokerLogTransport &
  DockerBrokerEventTransport;

interface DockerBrokerTransportOptions {
  socketPath?: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

function parseJsonBody(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    throw new DockerBrokerRequestError();
  }
}

function validatePositiveBound(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new DockerBrokerRequestError();
  return value;
}

async function getBrokerBody(
  socketPath: string,
  path: string,
  signal: AbortSignal | undefined,
  requestTimeoutMs: number,
  maxResponseBytes: number,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof DockerBrokerRequestError ? error : new DockerBrokerRequestError());
    };
    const succeed = (body: Buffer) => {
      if (settled) return;
      settled = true;
      resolve(body);
    };

    const req = request(
      {
        socketPath,
        path,
        method: "GET",
        headers: { accept: "application/json, application/octet-stream" },
        ...(signal === undefined ? {} : { signal }),
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          fail(new DockerBrokerRequestError(statusCode));
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        response.on("data", (chunk: Buffer) => {
          if (settled) return;
          totalBytes += chunk.length;
          if (totalBytes > maxResponseBytes) {
            fail(new DockerBrokerRequestError());
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", fail);
        response.once("end", () => succeed(Buffer.concat(chunks)));
      },
    );

    req.setTimeout(requestTimeoutMs, () => {
      fail(new DockerBrokerRequestError());
      req.destroy();
    });
    req.once("error", fail);
    req.end();
  });
}

async function getBrokerJson(
  socketPath: string,
  path: string,
  signal: AbortSignal | undefined,
  requestTimeoutMs: number,
  maxResponseBytes: number,
): Promise<unknown> {
  return parseJsonBody(
    await getBrokerBody(socketPath, path, signal, requestTimeoutMs, maxResponseBytes),
  );
}

export function createDockerBrokerTransport(
  options: DockerBrokerTransportOptions = {},
): DockerBrokerFullTransport {
  const socketPath =
    options.socketPath ?? process.env[DOCKER_BROKER_SOCKET_ENV] ?? DEFAULT_DOCKER_BROKER_SOCKET_PATH;
  const requestTimeoutMs = validatePositiveBound(
    options.requestTimeoutMs ?? DOCKER_BROKER_REQUEST_TIMEOUT_MS,
  );
  const maxResponseBytes = validatePositiveBound(
    options.maxResponseBytes ?? DOCKER_MAX_RESPONSE_BYTES,
  );

  const get = (path: string, signal?: AbortSignal) =>
    getBrokerJson(socketPath, path, signal, requestTimeoutMs, maxResponseBytes);

  return {
    async ping(signal?: AbortSignal): Promise<void> {
      const value = await get(DOCKER_BROKER_PING_PATH, signal);
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        Object.keys(value).length !== 1 ||
        (value as Record<string, unknown>).ok !== true
      ) {
        throw new DockerBrokerRequestError();
      }
    },
    version(signal?: AbortSignal) {
      return get(DOCKER_BROKER_VERSION_PATH, signal);
    },
    listContainers(signal?: AbortSignal) {
      return get(DOCKER_BROKER_CONTAINERS_PATH, signal);
    },
    inspectContainer(id: string, signal?: AbortSignal) {
      if (!isDockerContainerId(id)) return Promise.reject(new DockerBrokerRequestError());
      return get(dockerBrokerInspectPath(id), signal);
    },
    statsContainer(id: string, signal?: AbortSignal) {
      if (!isDockerContainerId(id)) return Promise.reject(new DockerBrokerRequestError());
      return get(dockerBrokerStatsPath(id), signal);
    },
    readLogs(source: DockerBrokerLogSource, range: DockerBrokerLogRange, signal?: AbortSignal) {
      let path: string;
      try {
        path = dockerBrokerLogsPath(source, range);
      } catch {
        return Promise.reject(new DockerBrokerRequestError());
      }
      return getBrokerBody(
        socketPath,
        path,
        signal,
        requestTimeoutMs,
        Math.min(maxResponseBytes, DOCKER_BROKER_LOG_MAX_RESPONSE_BYTES),
      );
    },
    async readEvents(since: number, until: number, signal?: AbortSignal): Promise<unknown[]> {
      let path: string;
      try {
        path = dockerBrokerEventsPath(since, until);
      } catch {
        throw new DockerBrokerRequestError();
      }
      const value = await get(path, signal);
      if (!Array.isArray(value) || value.length > DOCKER_BROKER_EVENTS_MAX_ITEMS) {
        throw new DockerBrokerRequestError();
      }
      return value;
    },
  };
}
