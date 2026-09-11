import { createServer, type Server, type ServerResponse } from "node:http";

import {
  parseContainerMetricsSnapshot,
  type ContainerMetricsSample,
  type ContainerMetricsSnapshot,
} from "./container-metrics-contract.js";
import {
  createDockerBrokerTransport,
  type DockerBrokerContainerMetricsTransport,
} from "./docker-broker-client.js";
import { DOCKER_BROKER_CONTAINER_METRICS_MAX_RESPONSE_BYTES } from "./docker-broker-protocol.js";

export const CONTAINER_METRICS_EXPORTER_PATH = "/metrics" as const;
export const CONTAINER_METRICS_EXPORTER_REQUEST_TIMEOUT_MS = 17_000;
export const CONTAINER_METRICS_EXPORTER_MAX_CONCURRENT_SCRAPES = 1;

export interface ContainerMetricsExporterServerOptions {
  transport?: DockerBrokerContainerMetricsTransport;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

function validatePositiveBound(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("invalid container metrics exporter bound");
  }
  return value;
}

function requestHasBody(headers: Readonly<Record<string, string | string[] | undefined>>): boolean {
  if (headers["transfer-encoding"] !== undefined) return true;
  const rawLength = headers["content-length"];
  if (rawLength === undefined) return false;
  const value = Array.isArray(rawLength) ? rawLength[0] : rawLength;
  return value !== undefined && value !== "0";
}

function escapePrometheusLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

function metricLabels(sample: ContainerMetricsSample): string {
  const identity = sample.identity;
  return [
    `compose_project="${escapePrometheusLabel(identity.composeProject)}"`,
    `compose_service="${escapePrometheusLabel(identity.composeService)}"`,
    `compose_container_number="${escapePrometheusLabel(identity.composeContainerNumber)}"`,
  ].join(",");
}

function formatMetricValue(value: number): string {
  return value === 0 ? "0" : String(value);
}

function appendFamily(
  lines: string[],
  name: string,
  type: "counter" | "gauge",
  help: string,
  snapshot: ContainerMetricsSnapshot,
  valueFor: (sample: ContainerMetricsSample) => number,
): void {
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} ${type}`);
  for (const sample of snapshot.containers) {
    lines.push(`${name}{${metricLabels(sample)}} ${formatMetricValue(valueFor(sample))}`);
  }
}

export function renderContainerMetrics(snapshot: ContainerMetricsSnapshot): string {
  const lines: string[] = [];
  appendFamily(
    lines,
    "container_cpu_usage_seconds_total",
    "counter",
    "Cumulative container CPU time in seconds.",
    snapshot,
    (sample) => sample.cpuUsageSeconds,
  );
  appendFamily(
    lines,
    "container_memory_working_set_bytes",
    "gauge",
    "Container memory working set in bytes.",
    snapshot,
    (sample) => sample.memoryWorkingSetBytes,
  );
  appendFamily(
    lines,
    "container_network_receive_bytes_total",
    "counter",
    "Cumulative container network receive bytes aggregated across interfaces.",
    snapshot,
    (sample) => sample.networkReceiveBytes,
  );
  appendFamily(
    lines,
    "container_network_transmit_bytes_total",
    "counter",
    "Cumulative container network transmit bytes aggregated across interfaces.",
    snapshot,
    (sample) => sample.networkTransmitBytes,
  );
  appendFamily(
    lines,
    "container_fs_reads_bytes_total",
    "counter",
    "Cumulative container filesystem read bytes aggregated across devices.",
    snapshot,
    (sample) => sample.filesystemReadBytes,
  );
  appendFamily(
    lines,
    "container_fs_writes_bytes_total",
    "counter",
    "Cumulative container filesystem write bytes aggregated across devices.",
    snapshot,
    (sample) => sample.filesystemWriteBytes,
  );
  return `${lines.join("\n")}\n`;
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  body: string,
  contentType = "text/plain; charset=utf-8",
): void {
  const bytes = Buffer.from(body, "utf8");
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Length", String(bytes.byteLength));
  response.end(bytes);
}

export function createContainerMetricsExporterServer(
  options: ContainerMetricsExporterServerOptions = {},
): Server {
  const transport = options.transport ?? createDockerBrokerTransport();
  const requestTimeoutMs = validatePositiveBound(
    options.requestTimeoutMs ?? CONTAINER_METRICS_EXPORTER_REQUEST_TIMEOUT_MS,
  );
  const maxResponseBytes = Math.min(
    validatePositiveBound(
      options.maxResponseBytes ?? DOCKER_BROKER_CONTAINER_METRICS_MAX_RESPONSE_BYTES,
    ),
    DOCKER_BROKER_CONTAINER_METRICS_MAX_RESPONSE_BYTES,
  );
  let activeScrapes = 0;

  const server = createServer((incoming, response) => {
    void (async () => {
      if (incoming.method !== "GET") {
        response.setHeader("Allow", "GET");
        sendText(response, 405, "METHOD_NOT_ALLOWED\n");
        return;
      }
      if (requestHasBody(incoming.headers)) {
        sendText(response, 400, "INVALID_REQUEST\n");
        return;
      }
      if (incoming.url !== CONTAINER_METRICS_EXPORTER_PATH) {
        sendText(response, 404, "NOT_FOUND\n");
        return;
      }
      if (activeScrapes >= CONTAINER_METRICS_EXPORTER_MAX_CONCURRENT_SCRAPES) {
        sendText(response, 503, "SOURCE_UNAVAILABLE\n");
        return;
      }

      activeScrapes += 1;
      const controller = new AbortController();
      const onAborted = () => controller.abort();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      timeout.unref();
      incoming.once("aborted", onAborted);

      try {
        const snapshot = parseContainerMetricsSnapshot(
          await transport.readContainerMetricsSnapshot(controller.signal),
        );
        const body = renderContainerMetrics(snapshot);
        if (Buffer.byteLength(body, "utf8") > maxResponseBytes) {
          throw new Error("container metrics exporter response too large");
        }
        if (!response.writableEnded) {
          sendText(
            response,
            200,
            body,
            "text/plain; version=0.0.4; charset=utf-8",
          );
        }
      } catch {
        if (!response.writableEnded) sendText(response, 503, "SOURCE_UNAVAILABLE\n");
      } finally {
        clearTimeout(timeout);
        incoming.off("aborted", onAborted);
        activeScrapes -= 1;
      }
    })().catch(() => {
      if (!response.writableEnded) sendText(response, 503, "SOURCE_UNAVAILABLE\n");
    });
  });

  server.requestTimeout = 2_000;
  server.headersTimeout = 1_500;
  server.keepAliveTimeout = 1_000;
  server.maxRequestsPerSocket = 4;
  server.on("clientError", (_error, socket) => socket.destroy());
  return server;
}
