import { request } from "node:http";

import { DOCKER_MAX_RESPONSE_BYTES, isDockerContainerId } from "./docker-api.js";
import {
  DEFAULT_DOCKER_BROKER_SOCKET_PATH,
  DOCKER_BROKER_CONTAINERS_PATH,
  DOCKER_BROKER_PING_PATH,
  DOCKER_BROKER_SOCKET_ENV,
  DOCKER_BROKER_VERSION_PATH,
  dockerBrokerInspectPath,
  dockerBrokerStatsPath,
} from "./docker-broker-protocol.js";

export const DOCKER_BROKER_REQUEST_TIMEOUT_MS = 1_500;

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

async function getBrokerJson(
  socketPath: string,
  path: string,
  signal: AbortSignal | undefined,
  requestTimeoutMs: number,
  maxResponseBytes: number,
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof DockerBrokerRequestError ? error : new DockerBrokerRequestError());
    };
    const succeed = (value: unknown) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const req = request(
      {
        socketPath,
        path,
        method: "GET",
        headers: { accept: "application/json" },
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
          totalBytes += chunk.length;
          if (totalBytes > maxResponseBytes) {
            const error = new DockerBrokerRequestError();
            fail(error);
            req.destroy(error);
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", fail);
        response.once("end", () => {
          try {
            succeed(parseJsonBody(Buffer.concat(chunks)));
          } catch (error: unknown) {
            fail(error);
          }
        });
      },
    );

    req.setTimeout(requestTimeoutMs, () => {
      const error = new DockerBrokerRequestError();
      fail(error);
      req.destroy(error);
    });
    req.once("error", fail);
    req.end();
  });
}

export function createDockerBrokerTransport(
  options: DockerBrokerTransportOptions = {},
): DockerBrokerTransport {
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
  };
}
