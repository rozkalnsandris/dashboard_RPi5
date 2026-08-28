import { parseLogSnapshot, type LogRange, type LogSnapshot } from "@dashboard-rpi5/contracts/logs";
import { request } from "node:http";

import {
  DEFAULT_LOG_BROKER_SOCKET_PATH,
  LOG_BROKER_MAX_RESPONSE_BYTES,
  LOG_BROKER_SOCKET_ENV,
  logBrokerLogsPath,
} from "./log-broker-protocol.js";
import type { PrivilegedLogSourceId } from "./privileged-log-sources.js";

export const LOG_BROKER_REQUEST_TIMEOUT_MS = 2_500;

export class LogBrokerRequestError extends Error {
  constructor(readonly statusCode: number | null = null) {
    super("Privileged log broker evidence is unavailable");
    this.name = "LogBrokerRequestError";
  }
}

export interface LogBrokerTransport {
  readLogs(sourceId: PrivilegedLogSourceId, range: LogRange, signal?: AbortSignal): Promise<LogSnapshot>;
}

interface LogBrokerTransportOptions { socketPath?: string; requestTimeoutMs?: number; maxResponseBytes?: number; }

function validatePositiveBound(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new LogBrokerRequestError();
  return value;
}

async function getBrokerBody(
  socketPath: string, path: string, signal: AbortSignal | undefined,
  requestTimeoutMs: number, maxResponseBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof LogBrokerRequestError ? error : new LogBrokerRequestError());
    };
    const succeed = (body: Buffer) => { if (settled) return; settled = true; resolve(body); };
    const req = request(
      { socketPath, path, method: "GET", headers: { accept: "application/json" }, ...(signal === undefined ? {} : { signal }) },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) { response.resume(); fail(new LogBrokerRequestError(statusCode)); return; }
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        response.on("data", (chunk: Buffer) => {
          if (settled) return;
          totalBytes += chunk.length;
          if (totalBytes > maxResponseBytes) { fail(new LogBrokerRequestError()); response.destroy(); return; }
          chunks.push(chunk);
        });
        response.once("error", fail);
        response.once("end", () => succeed(Buffer.concat(chunks)));
      },
    );
    req.setTimeout(requestTimeoutMs, () => { fail(new LogBrokerRequestError()); req.destroy(); });
    req.once("error", fail);
    req.end();
  });
}

export function createLogBrokerTransport(options: LogBrokerTransportOptions = {}): LogBrokerTransport {
  const socketPath = options.socketPath ?? process.env[LOG_BROKER_SOCKET_ENV] ?? DEFAULT_LOG_BROKER_SOCKET_PATH;
  const requestTimeoutMs = validatePositiveBound(options.requestTimeoutMs ?? LOG_BROKER_REQUEST_TIMEOUT_MS);
  const maxResponseBytes = Math.min(validatePositiveBound(options.maxResponseBytes ?? LOG_BROKER_MAX_RESPONSE_BYTES), LOG_BROKER_MAX_RESPONSE_BYTES);
  return {
    async readLogs(sourceId, range, signal) {
      let path: string;
      try { path = logBrokerLogsPath(sourceId, range); }
      catch { throw new LogBrokerRequestError(); }
      const body = await getBrokerBody(socketPath, path, signal, requestTimeoutMs, maxResponseBytes);
      let value: unknown;
      try { value = JSON.parse(body.toString("utf8")) as unknown; }
      catch { throw new LogBrokerRequestError(); }
      try {
        const snapshot = parseLogSnapshot(value);
        if (snapshot.source.sourceId !== sourceId || snapshot.range !== range) throw new LogBrokerRequestError();
        return snapshot;
      } catch (error: unknown) {
        if (error instanceof LogBrokerRequestError) throw error;
        throw new LogBrokerRequestError();
      }
    },
  };
}
