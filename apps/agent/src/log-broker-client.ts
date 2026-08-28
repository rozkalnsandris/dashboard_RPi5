import {
  parseLogSnapshot,
  type LogRange,
  type LogSnapshot,
  type LogSourceId,
} from "@dashboard-rpi5/contracts/logs";
import { request } from "node:http";

import {
  DEFAULT_LOG_BROKER_SOCKET_PATH,
  LOG_BROKER_MAX_RESPONSE_BYTES,
  LOG_BROKER_SOCKET_ENV,
  isLogBrokerSourceId,
  logBrokerLogsPath,
} from "./log-broker-protocol.js";

export const LOG_BROKER_CLIENT_TIMEOUT_MS = 3_500;

export class LogBrokerRequestError extends Error {
  constructor(readonly statusCode: number | null = null) {
    super("Log broker evidence is unavailable");
    this.name = "LogBrokerRequestError";
  }
}

export interface LogBrokerTransport {
  readSnapshot(
    sourceId: LogSourceId,
    range: LogRange,
    signal?: AbortSignal,
  ): Promise<LogSnapshot>;
}

interface LogBrokerTransportOptions {
  socketPath?: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

function positiveBound(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new LogBrokerRequestError();
  return value;
}

async function getBody(
  socketPath: string,
  path: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  maxResponseBytes: number,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof LogBrokerRequestError ? error : new LogBrokerRequestError());
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
        headers: { accept: "application/json" },
        ...(signal === undefined ? {} : { signal }),
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          fail(new LogBrokerRequestError(statusCode));
          return;
        }
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        response.on("data", (chunk: Buffer) => {
          if (settled) return;
          totalBytes += chunk.length;
          if (totalBytes > maxResponseBytes) {
            response.destroy();
            fail(new LogBrokerRequestError());
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", fail);
        response.once("end", () => succeed(Buffer.concat(chunks)));
      },
    );
    req.setTimeout(timeoutMs, () => {
      fail(new LogBrokerRequestError());
      req.destroy();
    });
    req.once("error", fail);
    req.end();
  });
}

export function createLogBrokerTransport(
  options: LogBrokerTransportOptions = {},
): LogBrokerTransport {
  const socketPath = options.socketPath ?? process.env[LOG_BROKER_SOCKET_ENV] ?? DEFAULT_LOG_BROKER_SOCKET_PATH;
  const requestTimeoutMs = positiveBound(options.requestTimeoutMs ?? LOG_BROKER_CLIENT_TIMEOUT_MS);
  const maxResponseBytes = positiveBound(options.maxResponseBytes ?? LOG_BROKER_MAX_RESPONSE_BYTES);

  return {
    async readSnapshot(sourceId, range, signal) {
      if (!isLogBrokerSourceId(sourceId)) throw new LogBrokerRequestError();
      let path: string;
      try {
        path = logBrokerLogsPath(sourceId, range);
      } catch {
        throw new LogBrokerRequestError();
      }
      const body = await getBody(socketPath, path, signal, requestTimeoutMs, maxResponseBytes);
      let value: unknown;
      try {
        value = JSON.parse(body.toString("utf8")) as unknown;
      } catch {
        throw new LogBrokerRequestError();
      }
      let snapshot: LogSnapshot;
      try {
        snapshot = parseLogSnapshot(value);
      } catch {
        throw new LogBrokerRequestError();
      }
      if (snapshot.source.sourceId !== sourceId || snapshot.range !== range) {
        throw new LogBrokerRequestError();
      }
      return snapshot;
    },
  };
}
