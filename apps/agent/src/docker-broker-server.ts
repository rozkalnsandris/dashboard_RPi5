import { createServer, request, type Server } from "node:http";
import { isAbsolute } from "node:path";

import {
  DEFAULT_DOCKER_ENGINE_SOCKET_PATH,
  DOCKER_API_PREFIX,
  DOCKER_ENGINE_SOCKET_ENV,
  DOCKER_MAX_RESPONSE_BYTES,
  DOCKER_REQUEST_TIMEOUT_MS,
  isDockerContainerId,
} from "./docker-api.js";
import {
  DOCKER_BROKER_MAX_CONCURRENT_REQUESTS,
  parseDockerBrokerRoute,
  type DockerBrokerRoute,
} from "./docker-broker-protocol.js";

export const DOCKER_BROKER_SERVICE_NAME = "dashboard-rpi5-docker-broker" as const;

export class DockerEngineUnavailableError extends Error {
  constructor() {
    super("Docker Engine evidence is unavailable");
    this.name = "DockerEngineUnavailableError";
  }
}

export class DockerEngineHttpStatusError extends DockerEngineUnavailableError {
  constructor(readonly statusCode: number) {
    super();
    this.name = "DockerEngineHttpStatusError";
  }
}

export interface DockerEngineReader {
  ping(signal?: AbortSignal): Promise<void>;
  version(signal?: AbortSignal): Promise<unknown>;
  listContainers(signal?: AbortSignal): Promise<unknown>;
  inspectContainer(id: string, signal?: AbortSignal): Promise<unknown>;
  statsContainer(id: string, signal?: AbortSignal): Promise<unknown>;
}

interface DockerEngineReaderOptions {
  socketPath?: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

type DockerEngineOperation =
  | { kind: "ping" }
  | { kind: "version" }
  | { kind: "containers" }
  | { kind: "inspect"; id: string }
  | { kind: "stats"; id: string };

function validatePositiveBound(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new DockerEngineUnavailableError();
  return value;
}

function validateDockerSocketPath(socketPath: string): string {
  if (socketPath.length === 0 || socketPath.includes("\0") || !isAbsolute(socketPath)) {
    throw new DockerEngineUnavailableError();
  }
  return socketPath;
}

function pathForOperation(operation: DockerEngineOperation): string {
  switch (operation.kind) {
    case "ping":
      return `${DOCKER_API_PREFIX}/_ping`;
    case "version":
      return `${DOCKER_API_PREFIX}/version`;
    case "containers":
      return `${DOCKER_API_PREFIX}/containers/json?all=true`;
    case "inspect":
      if (!isDockerContainerId(operation.id)) throw new DockerEngineUnavailableError();
      return `${DOCKER_API_PREFIX}/containers/${operation.id}/json`;
    case "stats":
      if (!isDockerContainerId(operation.id)) throw new DockerEngineUnavailableError();
      return `${DOCKER_API_PREFIX}/containers/${operation.id}/stats?stream=false`;
  }
}

async function readDockerEngineBody(
  socketPath: string,
  operation: DockerEngineOperation,
  signal: AbortSignal | undefined,
  requestTimeoutMs: number,
  maxResponseBytes: number,
): Promise<Buffer> {
  const path = pathForOperation(operation);

  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(
        error instanceof DockerEngineUnavailableError
          ? error
          : new DockerEngineUnavailableError(),
      );
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
        headers: { accept: operation.kind === "ping" ? "text/plain" : "application/json" },
        ...(signal === undefined ? {} : { signal }),
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          fail(new DockerEngineHttpStatusError(statusCode));
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        response.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > maxResponseBytes) {
            const error = new DockerEngineUnavailableError();
            fail(error);
            req.destroy(error);
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", fail);
        response.once("end", () => succeed(Buffer.concat(chunks)));
      },
    );

    req.setTimeout(requestTimeoutMs, () => {
      const error = new DockerEngineUnavailableError();
      fail(error);
      req.destroy(error);
    });
    req.once("error", fail);
    req.end();
  });
}

function parseDockerJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    throw new DockerEngineUnavailableError();
  }
}

export function createDockerEngineReader(
  options: DockerEngineReaderOptions = {},
): DockerEngineReader {
  const socketPath = validateDockerSocketPath(
    options.socketPath ??
      process.env[DOCKER_ENGINE_SOCKET_ENV] ??
      DEFAULT_DOCKER_ENGINE_SOCKET_PATH,
  );
  const requestTimeoutMs = validatePositiveBound(
    options.requestTimeoutMs ?? DOCKER_REQUEST_TIMEOUT_MS,
  );
  const maxResponseBytes = validatePositiveBound(
    options.maxResponseBytes ?? DOCKER_MAX_RESPONSE_BYTES,
  );

  const read = (operation: DockerEngineOperation, signal?: AbortSignal) =>
    readDockerEngineBody(
      socketPath,
      operation,
      signal,
      requestTimeoutMs,
      maxResponseBytes,
    );

  return {
    async ping(signal?: AbortSignal): Promise<void> {
      const body = await read({ kind: "ping" }, signal);
      if (body.toString("utf8").trim() !== "OK") throw new DockerEngineUnavailableError();
    },
    async version(signal?: AbortSignal): Promise<unknown> {
      return parseDockerJson(await read({ kind: "version" }, signal));
    },
    async listContainers(signal?: AbortSignal): Promise<unknown> {
      return parseDockerJson(await read({ kind: "containers" }, signal));
    },
    async inspectContainer(id: string, signal?: AbortSignal): Promise<unknown> {
      if (!isDockerContainerId(id)) throw new DockerEngineUnavailableError();
      return parseDockerJson(await read({ kind: "inspect", id }, signal));
    },
    async statsContainer(id: string, signal?: AbortSignal): Promise<unknown> {
      if (!isDockerContainerId(id)) throw new DockerEngineUnavailableError();
      return parseDockerJson(await read({ kind: "stats", id }, signal));
    },
  };
}

interface DockerBrokerServerOptions {
  engineReader?: DockerEngineReader;
  maxConcurrentRequests?: number;
}

function requestHasBody(headers: Readonly<Record<string, string | string[] | undefined>>): boolean {
  if (headers["transfer-encoding"] !== undefined) return true;
  const rawLength = headers["content-length"];
  if (rawLength === undefined) return false;
  const value = Array.isArray(rawLength) ? rawLength[0] : rawLength;
  return value !== undefined && value !== "0";
}

function sendJson(response: import("node:http").ServerResponse, statusCode: number, value: unknown) {
  let body: Buffer;
  try {
    body = Buffer.from(JSON.stringify(value), "utf8");
  } catch {
    statusCode = 503;
    body = Buffer.from('{"error":"SOURCE_UNAVAILABLE"}', "utf8");
  }

  if (body.byteLength > DOCKER_MAX_RESPONSE_BYTES) {
    statusCode = 503;
    body = Buffer.from('{"error":"SOURCE_UNAVAILABLE"}', "utf8");
  }

  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Length", String(body.byteLength));
  response.end(body);
}

async function dispatchRoute(
  route: DockerBrokerRoute,
  engineReader: DockerEngineReader,
  signal: AbortSignal,
): Promise<unknown> {
  switch (route.kind) {
    case "health":
      return { status: "ok", service: DOCKER_BROKER_SERVICE_NAME };
    case "ping":
      await engineReader.ping(signal);
      return { ok: true };
    case "version":
      return engineReader.version(signal);
    case "containers":
      return engineReader.listContainers(signal);
    case "inspect":
      return engineReader.inspectContainer(route.id, signal);
    case "stats":
      return engineReader.statsContainer(route.id, signal);
  }
}

export function createDockerBrokerServer(
  options: DockerBrokerServerOptions = {},
): Server {
  const engineReader = options.engineReader ?? createDockerEngineReader();
  const maxConcurrentRequests = validatePositiveBound(
    options.maxConcurrentRequests ?? DOCKER_BROKER_MAX_CONCURRENT_REQUESTS,
  );
  let activeRequests = 0;

  const server = createServer((incoming, response) => {
    void (async () => {
      if (incoming.method !== "GET") {
        response.setHeader("Allow", "GET");
        sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
        return;
      }
      if (requestHasBody(incoming.headers)) {
        sendJson(response, 400, { error: "INVALID_REQUEST" });
        return;
      }

      const route = parseDockerBrokerRoute(incoming.url ?? "");
      if (route === null) {
        sendJson(response, 404, { error: "NOT_FOUND" });
        return;
      }
      if (route.kind === "health") {
        sendJson(response, 200, await dispatchRoute(route, engineReader, AbortSignal.timeout(500)));
        return;
      }
      if (activeRequests >= maxConcurrentRequests) {
        sendJson(response, 503, { error: "SOURCE_UNAVAILABLE" });
        return;
      }

      activeRequests += 1;
      const controller = new AbortController();
      const abort = () => controller.abort();
      incoming.once("aborted", abort);

      try {
        const value = await dispatchRoute(route, engineReader, controller.signal);
        if (!response.writableEnded) sendJson(response, 200, value);
      } catch (error: unknown) {
        if (response.writableEnded) return;
        const statusCode =
          error instanceof DockerEngineHttpStatusError &&
          error.statusCode === 404 &&
          (route.kind === "inspect" || route.kind === "stats")
            ? 404
            : 503;
        sendJson(response, statusCode, {
          error: statusCode === 404 ? "NOT_FOUND" : "SOURCE_UNAVAILABLE",
        });
      } finally {
        incoming.off("aborted", abort);
        activeRequests -= 1;
      }
    })().catch(() => {
      if (!response.writableEnded) sendJson(response, 503, { error: "SOURCE_UNAVAILABLE" });
    });
  });

  server.requestTimeout = 3_000;
  server.headersTimeout = 2_000;
  server.keepAliveTimeout = 1_000;
  server.maxRequestsPerSocket = 16;
  server.on("clientError", (_error, socket) => socket.destroy());
  return server;
}
