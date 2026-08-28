import type { LogSnapshot } from "@dashboard-rpi5/contracts/logs";
import { createServer, type Server, type ServerResponse } from "node:http";

import {
  LOG_BROKER_MAX_CONCURRENT_REQUESTS,
  LOG_BROKER_MAX_RESPONSE_BYTES,
  LOG_BROKER_REQUEST_TIMEOUT_MS,
  parseLogBrokerRoute,
  type LogBrokerRange,
  type LogBrokerSourceId,
} from "./log-broker-protocol.js";
import { readBrokerLogSnapshot } from "./log-broker-reader.js";

export const LOG_BROKER_SERVICE_NAME = "dashboard-rpi5-log-broker" as const;

export interface LogBrokerReader {
  read(
    sourceId: LogBrokerSourceId,
    range: LogBrokerRange,
    signal?: AbortSignal,
  ): Promise<LogSnapshot>;
}

interface LogBrokerServerOptions {
  reader?: LogBrokerReader;
  maxConcurrentRequests?: number;
  maxResponseBytes?: number;
  requestTimeoutMs?: number;
}

function positiveBound(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("invalid log broker bound");
  return value;
}

function requestHasBody(headers: Readonly<Record<string, string | string[] | undefined>>): boolean {
  if (headers["transfer-encoding"] !== undefined) return true;
  const rawLength = headers["content-length"];
  if (rawLength === undefined) return false;
  const value = Array.isArray(rawLength) ? rawLength[0] : rawLength;
  return value !== undefined && value !== "0";
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
  maxResponseBytes: number,
) {
  let body: Buffer;
  try {
    body = Buffer.from(JSON.stringify(value), "utf8");
  } catch {
    statusCode = 503;
    body = Buffer.from('{"error":"SOURCE_UNAVAILABLE"}', "utf8");
  }
  if (body.byteLength > maxResponseBytes) {
    statusCode = 503;
    body = Buffer.from('{"error":"SOURCE_UNAVAILABLE"}', "utf8");
  }
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Length", String(body.byteLength));
  response.end(body);
}

async function readWithDeadline(
  reader: LogBrokerReader,
  sourceId: LogBrokerSourceId,
  range: LogBrokerRange,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<LogSnapshot> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("log broker deadline exceeded"));
      }, timeoutMs);
      timer.unref();
    });
    return await Promise.race([reader.read(sourceId, range, controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

export function createLogBrokerServer(options: LogBrokerServerOptions = {}): Server {
  const reader = options.reader ?? { read: (sourceId, range, signal) => readBrokerLogSnapshot(sourceId, range, undefined, signal) };
  const maxConcurrentRequests = positiveBound(
    options.maxConcurrentRequests ?? LOG_BROKER_MAX_CONCURRENT_REQUESTS,
  );
  const maxResponseBytes = positiveBound(options.maxResponseBytes ?? LOG_BROKER_MAX_RESPONSE_BYTES);
  const requestTimeoutMs = positiveBound(options.requestTimeoutMs ?? LOG_BROKER_REQUEST_TIMEOUT_MS);
  let activeRequests = 0;

  const server = createServer((incoming, response) => {
    void (async () => {
      if (incoming.method !== "GET") {
        response.setHeader("Allow", "GET");
        sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" }, maxResponseBytes);
        return;
      }
      if (requestHasBody(incoming.headers)) {
        sendJson(response, 400, { error: "INVALID_REQUEST" }, maxResponseBytes);
        return;
      }
      const route = parseLogBrokerRoute(incoming.url ?? "");
      if (route === null) {
        sendJson(response, 404, { error: "NOT_FOUND" }, maxResponseBytes);
        return;
      }
      if (route.kind === "health") {
        sendJson(response, 200, { status: "ok", service: LOG_BROKER_SERVICE_NAME }, maxResponseBytes);
        return;
      }
      if (activeRequests >= maxConcurrentRequests) {
        sendJson(response, 503, { error: "SOURCE_UNAVAILABLE" }, maxResponseBytes);
        return;
      }

      activeRequests += 1;
      const controller = new AbortController();
      const abort = () => controller.abort();
      incoming.once("aborted", abort);
      try {
        const snapshot = await readWithDeadline(
          reader,
          route.sourceId,
          route.range,
          controller.signal,
          requestTimeoutMs,
        );
        if (!response.writableEnded) sendJson(response, 200, snapshot, maxResponseBytes);
      } catch {
        if (!response.writableEnded) {
          sendJson(response, 503, { error: "SOURCE_UNAVAILABLE" }, maxResponseBytes);
        }
      } finally {
        incoming.off("aborted", abort);
        activeRequests -= 1;
      }
    })().catch(() => {
      if (!response.writableEnded) {
        sendJson(response, 503, { error: "SOURCE_UNAVAILABLE" }, maxResponseBytes);
      }
    });
  });

  server.requestTimeout = requestTimeoutMs + 1_000;
  server.headersTimeout = 2_000;
  server.keepAliveTimeout = 1_000;
  server.maxRequestsPerSocket = 16;
  server.on("clientError", (_error, socket) => socket.destroy());
  return server;
}
