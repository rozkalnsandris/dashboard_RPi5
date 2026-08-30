import { request } from "node:http";
import { isAbsolute } from "node:path";

import {
  DEFAULT_DOCKER_ENGINE_SOCKET_PATH,
  DOCKER_ENGINE_SOCKET_ENV,
  DOCKER_MAX_RESPONSE_BYTES,
  DOCKER_REQUEST_TIMEOUT_MS,
} from "./docker-api.js";
import { dockerApiPrefix, selectDockerApiVersion } from "./docker-api-version.js";
import {
  DOCKER_BROKER_EVENTS_MAX_ITEMS,
  DOCKER_BROKER_EVENTS_MAX_WINDOW_SECONDS,
} from "./docker-broker-protocol.js";
import { DockerEventStreamDecoder, buildDockerEventsPath } from "./docker-events.js";

export class DockerBrokerEventsSourceError extends Error {
  constructor() {
    super("Docker events evidence is unavailable");
    this.name = "DockerBrokerEventsSourceError";
  }
}

export interface DockerEventReader {
  readEvents(since: number, until: number, signal?: AbortSignal): Promise<unknown[]>;
}

interface DockerEventReaderOptions {
  socketPath?: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  maxItems?: number;
}

function positiveBound(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new DockerBrokerEventsSourceError();
  return value;
}

function dockerSocketPath(value: string): string {
  if (!isAbsolute(value) || value.length === 0 || value.includes("\0")) {
    throw new DockerBrokerEventsSourceError();
  }
  return value;
}

function validateWindow(since: number, until: number) {
  if (
    !Number.isSafeInteger(since) ||
    !Number.isSafeInteger(until) ||
    since < 0 ||
    until < since ||
    until - since > DOCKER_BROKER_EVENTS_MAX_WINDOW_SECONDS
  ) {
    throw new DockerBrokerEventsSourceError();
  }
}

async function discoverDockerApiVersion(
  socketPath: string,
  signal: AbortSignal | undefined,
  requestTimeoutMs: number,
  maxResponseBytes: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      reject(new DockerBrokerEventsSourceError());
    };

    const req = request(
      {
        socketPath,
        path: "/version",
        method: "GET",
        headers: { accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          fail();
          return;
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        response.on("data", (chunk: Buffer | string) => {
          if (settled) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.byteLength;
          if (totalBytes > maxResponseBytes) {
            response.destroy();
            fail();
            return;
          }
          chunks.push(buffer);
        });
        response.once("error", fail);
        response.once("end", () => {
          if (settled) return;
          try {
            const evidence = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
            const apiVersion = selectDockerApiVersion(evidence);
            settled = true;
            resolve(apiVersion);
          } catch {
            fail();
          }
        });
      },
    );

    req.setTimeout(requestTimeoutMs, () => {
      req.destroy();
      fail();
    });
    req.once("error", fail);
    req.end();
  });
}

export function createDockerEventReader(options: DockerEventReaderOptions = {}): DockerEventReader {
  const socketPath = dockerSocketPath(
    options.socketPath ??
      process.env[DOCKER_ENGINE_SOCKET_ENV] ??
      DEFAULT_DOCKER_ENGINE_SOCKET_PATH,
  );
  const requestTimeoutMs = positiveBound(options.requestTimeoutMs ?? DOCKER_REQUEST_TIMEOUT_MS);
  const maxResponseBytes = Math.min(
    positiveBound(options.maxResponseBytes ?? DOCKER_MAX_RESPONSE_BYTES),
    DOCKER_MAX_RESPONSE_BYTES,
  );
  const maxItems = Math.min(
    positiveBound(options.maxItems ?? DOCKER_BROKER_EVENTS_MAX_ITEMS),
    DOCKER_BROKER_EVENTS_MAX_ITEMS,
  );
  let negotiatedApiVersion: string | null = null;

  const resolveVersion = async (signal?: AbortSignal) => {
    if (negotiatedApiVersion !== null) return negotiatedApiVersion;
    negotiatedApiVersion = await discoverDockerApiVersion(
      socketPath,
      signal,
      requestTimeoutMs,
      maxResponseBytes,
    );
    return negotiatedApiVersion;
  };

  return {
    async readEvents(since, until, signal) {
      validateWindow(since, until);
      const legacyPath = buildDockerEventsPath(since, until);
      const legacyUrl = new URL(legacyPath, "http://docker.local");
      const apiVersion = await resolveVersion(signal);
      let prefix: string;
      try {
        prefix = dockerApiPrefix(apiVersion);
      } catch {
        negotiatedApiVersion = null;
        throw new DockerBrokerEventsSourceError();
      }
      const path = `${prefix}/events?${legacyUrl.searchParams.toString()}`;

      try {
        return await new Promise<unknown[]>((resolve, reject) => {
          let settled = false;
          let completedFrames = 0;
          const decoder = new DockerEventStreamDecoder();
          const fail = () => {
            if (settled) return;
            settled = true;
            reject(new DockerBrokerEventsSourceError());
          };
          const succeed = (values: unknown[]) => {
            if (settled) return;
            if (values.length > maxItems) {
              fail();
              return;
            }
            settled = true;
            resolve(values);
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
                fail();
                return;
              }

              let totalBytes = 0;
              response.on("data", (chunk: Buffer | string) => {
                if (settled) return;
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                totalBytes += buffer.byteLength;
                for (const byte of buffer) {
                  if (byte === 0x0a) completedFrames += 1;
                }
                if (totalBytes > maxResponseBytes || completedFrames > maxItems) {
                  response.destroy();
                  fail();
                  return;
                }
                try {
                  decoder.push(buffer);
                } catch {
                  response.destroy();
                  fail();
                }
              });
              response.once("error", fail);
              response.once("end", () => {
                if (settled) return;
                try {
                  succeed(decoder.finish());
                } catch {
                  fail();
                }
              });
            },
          );

          req.setTimeout(requestTimeoutMs, () => {
            req.destroy();
            fail();
          });
          req.once("error", fail);
          req.end();
        });
      } catch (error: unknown) {
        negotiatedApiVersion = null;
        throw error;
      }
    },
  };
}
