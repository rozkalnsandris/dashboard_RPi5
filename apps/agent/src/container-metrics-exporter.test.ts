import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  CONTAINER_METRICS_SNAPSHOT_SCHEMA,
  type ContainerMetricsSnapshot,
} from "./container-metrics-contract.js";
import {
  CONTAINER_METRICS_EXPORTER_PATH,
  createContainerMetricsExporterServer,
  renderContainerMetrics,
} from "./container-metrics-exporter.js";
import {
  parseContainerMetricsListenPort,
  validateContainerMetricsListenHost,
} from "./container-metrics-exporter-entry.js";
import type { DockerBrokerContainerMetricsTransport } from "./docker-broker-client.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function snapshot(): ContainerMetricsSnapshot {
  return {
    schema: CONTAINER_METRICS_SNAPSHOT_SCHEMA,
    observedAt: "2026-09-10T18:00:00.000Z",
    containers: [
      {
        identity: {
          composeProject: "dash",
          composeService: "web",
          composeContainerNumber: "1",
        },
        cpuUsageSeconds: 1.25,
        memoryWorkingSetBytes: 1024,
        networkReceiveBytes: 2048,
        networkTransmitBytes: 4096,
        filesystemReadBytes: 8192,
        filesystemWriteBytes: 16384,
      },
    ],
  };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => resolve());
  });
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );
  return (server.address() as AddressInfo).port;
}

async function httpRequest(
  port: number,
  path: string,
  method = "GET",
): Promise<{ status: number; body: string; allow: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("error", reject);
        response.once("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            allow: typeof response.headers.allow === "string" ? response.headers.allow : undefined,
          }),
        );
      },
    );
    req.once("error", reject);
    req.end();
  });
}

describe("container metrics Prometheus exporter", () => {
  it("renders only the six approved metric families and fixed Compose identity labels", () => {
    const output = renderContainerMetrics(snapshot());
    for (const name of [
      "container_cpu_usage_seconds_total",
      "container_memory_working_set_bytes",
      "container_network_receive_bytes_total",
      "container_network_transmit_bytes_total",
      "container_fs_reads_bytes_total",
      "container_fs_writes_bytes_total",
    ]) {
      expect(output).toContain(`# TYPE ${name} `);
      expect(output).toContain(`${name}{compose_project="dash",compose_service="web",compose_container_number="1"}`);
    }
    expect(output).not.toContain("docker_id");
    expect(output).not.toContain("container_name");
    expect(output).not.toContain("environment");
  });

  it("allows only explicit loopback/private IPv4 listener addresses", () => {
    expect(validateContainerMetricsListenHost("127.0.0.1")).toBe("127.0.0.1");
    expect(validateContainerMetricsListenHost("10.0.0.2")).toBe("10.0.0.2");
    expect(validateContainerMetricsListenHost("172.17.0.1")).toBe("172.17.0.1");
    expect(validateContainerMetricsListenHost("192.168.1.2")).toBe("192.168.1.2");
    for (const host of ["0.0.0.0", "::", "8.8.8.8", "metrics.example.com"]) {
      expect(() => validateContainerMetricsListenHost(host)).toThrow();
    }
    expect(parseContainerMetricsListenPort(undefined)).toBe(9464);
    expect(parseContainerMetricsListenPort("9464")).toBe(9464);
    expect(() => parseContainerMetricsListenPort("80")).toThrow();
    expect(() => parseContainerMetricsListenPort("70000")).toThrow();
  });

  it("serves only exact GET /metrics and rejects concurrent scrapes", async () => {
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scrapeStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const transport: DockerBrokerContainerMetricsTransport = {
      async readContainerMetricsSnapshot() {
        started();
        await held;
        return snapshot();
      },
    };
    const server = createContainerMetricsExporterServer({ transport });
    const port = await listen(server);

    expect(await httpRequest(port, "/")).toMatchObject({ status: 404, body: "NOT_FOUND\n" });
    expect(await httpRequest(port, `${CONTAINER_METRICS_EXPORTER_PATH}?x=1`)).toMatchObject({
      status: 404,
    });
    expect(await httpRequest(port, CONTAINER_METRICS_EXPORTER_PATH, "POST")).toMatchObject({
      status: 405,
      allow: "GET",
    });

    const first = httpRequest(port, CONTAINER_METRICS_EXPORTER_PATH);
    await scrapeStarted;
    expect(await httpRequest(port, CONTAINER_METRICS_EXPORTER_PATH)).toMatchObject({
      status: 503,
      body: "SOURCE_UNAVAILABLE\n",
    });
    release();

    const successful = await first;
    expect(successful.status).toBe(200);
    expect(successful.body).toContain("container_cpu_usage_seconds_total");
  });
});
