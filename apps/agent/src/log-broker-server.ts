import type { LogRange, LogSnapshot } from "@dashboard-rpi5/contracts/logs";
import { createServer, type Server, type ServerResponse } from "node:http";

import {
  LOG_BROKER_MAX_CONCURRENT_REQUESTS,
  LOG_BROKER_MAX_RESPONSE_BYTES,
  LOG_BROKER_OPERATION_TIMEOUT_MS,
  parseLogBrokerRoute,
  type LogBrokerRoute,
} from "./log-broker-protocol.js";
import { readPrivilegedLogSnapshot } from "./log-broker-reader.js";
import type { PrivilegedLogSourceId } from "./privileged-log-sources.js";

export const LOG_BROKER_SERVICE_NAME = "dashboard-rpi5-log-broker" as const;

export interface PrivilegedLogReader {
  (sourceId: PrivilegedLogSourceId, range: LogRange, signal?: AbortSignal): Promise<LogSnapshot>;
}

interface LogBrokerServerOptions {
  reader?: PrivilegedLogReader;
  maxConcurrentRequests?: number;
  operationTimeoutMs?: number;
}

function validatePositiveBound(value: number): number {
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

function sendJson(response: ServerResponse, statusCode: number, value: unknown) {
  let body: Buffer;
  try { body = Buffer.from(JSON.stringify(value), "utf8"); }
  catch { statusCode = 503; body = Buffer.from('{"error":"SOURCE_UNAVAILABLE"}', "utf8"); }
  if (body.byteLength > LOG_BROKER_MAX_RESPONSE_BYTES) {
    statusCode = 503;
    body = Buffer.from('{"error":"SOURCE_UNAVAILABLE"}', "utf8");
  }
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Length", String(body.byteLength));
  response.end(body);
}

async function dispatchRoute(route: LogBrokerRoute, reader: PrivilegedLogReader, signal: AbortSignal): Promise<unknown> {
  if (route.kind === "health") return { status: "ok", service: LOG_BROKER_SERVICE_NAME };
  return reader(route.sourceId, route.range, signal);
}

export function createLogBrokerServer(options: LogBrokerServerOptions = {}): Server {
  const reader = options.reader ?? readPrivilegedLogSnapshot;
  const maxConcurrentRequests = validatePositiveBound(options.maxConcurrentRequests ?? LOG_BROKER_MAX_CONCURRENT_REQUESTS);
  const operationTimeoutMs = validatePositiveBound(options.operationTimeoutMs ?? LOG_BROKER_OPERATION_TIMEOUT_MS);
  let activeRequests = 0;

  return createServer((incoming, response) => {
    void (async () => {
      if (incoming.method !== "GET") {
        response.setHeader("Allow", "GET");
        sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
        return;
      }
      if (requestHasBody(incoming.headers)) { sendJson(response, 400, { error: "INVALID_REQUEST" }); return; }
      const route = parseLogBrokerRoute(incoming.url ?? "");
      if (route === null) { sendJson(response, 404, { error: "NOT_FOUND" }); return; }
      if (route.kind === "health") {
        sendJson(response, 200, await dispatchRoute(route, reader, AbortSignal.timeout(500)));
        return;
      }
      if (activeRequests >= maxConcurrentRequests) { sendJson(response, 503, { error: "SOURCE_UNAVAILABLE" }); return; }

      activeRequests += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), operationTimeoutMs);
      const abort = () => controller.abort();
      incoming.once("aborted", abort);
      try {
        const value = await dispatchRoute(route, reader, controller.signal);
        if (!response.writableEnded) sendJson(response, 200, value);
      } catch {
        if (!response.writableEnded) sendJson(response, 503, { error: "SOURCE_UNAVAILABLE" });
      } finally {
        clearTimeout(timer);
        incoming.off("aborted", abort);
        activeRequests -= 1;
      }
    })().catch(() => {
      if (!response.writableEnded) sendJson(response, 503, { error: "SOURCE_UNAVAILABLE" });
    });
  });
}
