import { isIP } from "node:net";

import { isDirectCliInvocation } from "./cli-entry.js";
import { createContainerMetricsExporterServer } from "./container-metrics-exporter.js";

export const CONTAINER_METRICS_LISTEN_HOST_ENV =
  "DASHBOARD_CONTAINER_METRICS_LISTEN_HOST" as const;
export const CONTAINER_METRICS_LISTEN_PORT_ENV =
  "DASHBOARD_CONTAINER_METRICS_LISTEN_PORT" as const;
export const DEFAULT_CONTAINER_METRICS_LISTEN_HOST = "127.0.0.1";
export const DEFAULT_CONTAINER_METRICS_LISTEN_PORT = 9464;

function privateIpv4(host: string): boolean {
  if (isIP(host) !== 4) return false;
  const parts = host.split(".").map(Number);
  const first = parts[0] ?? -1;
  const second = parts[1] ?? -1;
  return (
    first === 127 ||
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function validateContainerMetricsListenHost(host: string): string {
  if (!privateIpv4(host)) {
    throw new Error("container metrics exporter requires an explicit loopback/private IPv4 bind");
  }
  return host;
}

export function parseContainerMetricsListenPort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_CONTAINER_METRICS_LISTEN_PORT;
  if (!/^(?:[1-9][0-9]{3,4})$/.test(value)) {
    throw new Error("invalid container metrics exporter port");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error("invalid container metrics exporter port");
  }
  return port;
}

export interface StartContainerMetricsExporterOptions {
  host?: string;
  port?: number;
}

export async function startContainerMetricsExporter(
  options: StartContainerMetricsExporterOptions = {},
) {
  const host = validateContainerMetricsListenHost(
    options.host ??
      process.env[CONTAINER_METRICS_LISTEN_HOST_ENV] ??
      DEFAULT_CONTAINER_METRICS_LISTEN_HOST,
  );
  const port =
    options.port ??
    parseContainerMetricsListenPort(process.env[CONTAINER_METRICS_LISTEN_PORT_ENV]);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error("invalid container metrics exporter port");
  }

  const server = createContainerMetricsExporterServer();
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host, port, exclusive: true });
  });

  return { server, host, port };
}

async function runFromCli() {
  const running = await startContainerMetricsExporter();
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    running.server.close(() => undefined);
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

if (isDirectCliInvocation()) {
  void runFromCli().catch(() => {
    console.error("dashboard-rpi5-container-metrics-exporter failed to start");
    process.exitCode = 1;
  });
}
