import { request } from "node:http";
import { isAbsolute } from "node:path";

import {
  DEFAULT_DOCKER_ENGINE_SOCKET_PATH,
  DOCKER_ENGINE_SOCKET_ENV,
  DOCKER_MAX_RESPONSE_BYTES,
  DOCKER_REQUEST_TIMEOUT_MS,
} from "./docker-api.js";
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

  return {
    async readEvents(since, until, signal) {
      validateWindow(since, until);
      const path = buildDockerEventsPath(since, until);

      return new Promise<unknown[]>((resolve, reject) => {
        let settled = false;
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
              if (totalBytes > maxResponseBytes) {
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
    },
  };
}
