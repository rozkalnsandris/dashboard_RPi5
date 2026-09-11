import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { CONTAINER_METRICS_SNAPSHOT_SCHEMA } from "./container-metrics-contract.js";
import { DOCKER_BROKER_CONTAINER_METRICS_PATH } from "./docker-broker-protocol.js";
import {
  createDockerBrokerServer,
  type DockerEngineReader,
} from "./docker-broker-server.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function unusedEngineReader(): DockerEngineReader {
  return {
    async ping() {
      throw new Error("unexpected");
    },
    async version() {
      throw new Error("unexpected");
    },
    async listContainers() {
      throw new Error("unexpected");
    },
    async inspectContainer() {
      throw new Error("unexpected");
    },
    async statsContainer() {
      throw new Error("unexpected");
    },
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

async function get(port: number, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: response.statusCode ?? 0,
          body: raw === "" ? null : (JSON.parse(raw) as unknown),
        });
      });
    });
    req.once("error", reject);
    req.end();
  });
}

describe("Docker broker container metrics capability", () => {
  it("exposes only one fixed snapshot and rejects a concurrent snapshot", async () => {
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const snapshotStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const server = createDockerBrokerServer({
      engineReader: unusedEngineReader(),
      containerMetricsReader: {
        async readSnapshot() {
          started();
          await held;
          return {
            schema: CONTAINER_METRICS_SNAPSHOT_SCHEMA,
            observedAt: "2026-09-10T18:00:00.000Z",
            containers: [],
          };
        },
      },
    });
    const port = await listen(server);

    const first = get(port, DOCKER_BROKER_CONTAINER_METRICS_PATH);
    await snapshotStarted;
    expect(await get(port, DOCKER_BROKER_CONTAINER_METRICS_PATH)).toEqual({
      status: 503,
      body: { error: "SOURCE_UNAVAILABLE" },
    });
    release();

    expect(await first).toEqual({
      status: 200,
      body: {
        schema: CONTAINER_METRICS_SNAPSHOT_SCHEMA,
        observedAt: "2026-09-10T18:00:00.000Z",
        containers: [],
      },
    });
  });

  it("rejects metrics selectors instead of forwarding caller-controlled Docker scope", async () => {
    const server = createDockerBrokerServer({
      engineReader: unusedEngineReader(),
      containerMetricsReader: {
        async readSnapshot() {
          throw new Error("unexpected");
        },
      },
    });
    const port = await listen(server);
    expect(await get(port, `${DOCKER_BROKER_CONTAINER_METRICS_PATH}?container=all`)).toEqual({
      status: 404,
      body: { error: "NOT_FOUND" },
    });
  });
});
