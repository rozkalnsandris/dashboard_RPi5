import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createDockerBrokerTransport,
  DockerBrokerRequestError,
} from "./docker-broker-client.js";
import {
  DOCKER_BROKER_LOG_MAX_RESPONSE_BYTES,
  DOCKER_BROKER_LOG_TAIL,
  dockerBrokerLogsPath,
  parseDockerBrokerRoute,
  type DockerBrokerLogRange,
  type DockerBrokerLogSource,
} from "./docker-broker-protocol.js";
import {
  createDockerBrokerServer,
  createDockerLogReader,
  DockerEngineUnavailableError,
} from "./docker-broker-server.js";

const cleanups: Array<() => Promise<void>> = [];

const FIXED_NOW = new Date("2026-08-19T16:30:00.000Z");
const NOW_SECONDS = Math.floor(FIXED_NOW.getTime() / 1_000);

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function tempSocket(name: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(resolve(tmpdir(), "dashboard-rpi5-docker-logs-"));
  return {
    path: resolve(root, name),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function listenUnix(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolvePromise);
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
}

async function unixBufferRequest(
  socketPath: string,
  path: string,
  method = "GET",
): Promise<{ status: number; body: Buffer; allow: string | undefined }> {
  return new Promise((resolvePromise, reject) => {
    const req = request({ socketPath, path, method }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => {
        resolvePromise({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks),
          allow: typeof response.headers.allow === "string" ? response.headers.allow : undefined,
        });
      });
    });
    req.once("error", reject);
    req.end();
  });
}

describe("registered Docker log broker protocol", () => {
  it("accepts exactly two registered sources and four bounded ranges", () => {
    for (const source of ["homeassistant", "prometheus"] as const) {
      for (const range of ["15m", "1h", "6h", "24h"] as const) {
        expect(parseDockerBrokerRoute(dockerBrokerLogsPath(source, range))).toEqual({
          kind: "logs",
          source,
          range,
        });
      }
    }
  });

  it("rejects arbitrary containers, ranges, queries and traversal", () => {
    for (const path of [
      "/v1/docker/logs/grafana/15m",
      "/v1/docker/logs/homeassistant/7d",
      "/v1/docker/logs/homeassistant/15m?tail=999999",
      "/v1/docker/logs/homeassistant/15m?stdout=false",
      "/v1/docker/logs/../version/15m",
      "/v1/docker/logs/homeassistant/15m/extra",
    ]) {
      expect(parseDockerBrokerRoute(path), path).toBeNull();
    }

    expect(() =>
      dockerBrokerLogsPath("grafana" as DockerBrokerLogSource, "15m"),
    ).toThrow();
    expect(() =>
      dockerBrokerLogsPath("homeassistant", "7d" as DockerBrokerLogRange),
    ).toThrow();
  });
});

describe("Docker Engine log reader authority", () => {
  it("constructs only fixed Engine GET paths with broker-owned flags and bounds", async () => {
    const socket = await tempSocket("docker.sock");
    const requests: Array<{ method: string | undefined; url: string | undefined }> = [];
    const fakeDocker = createServer((incoming, response) => {
      requests.push({ method: incoming.method, url: incoming.url });
      response.statusCode = 200;
      response.end(Buffer.from("docker-log-body", "utf8"));
    });
    cleanups.push(socket.cleanup, () => closeServer(fakeDocker));
    await listenUnix(fakeDocker, socket.path);

    const reader = createDockerLogReader({ socketPath: socket.path, now: () => FIXED_NOW });
    expect((await reader.readLogs("homeassistant", "15m")).toString("utf8")).toBe(
      "docker-log-body",
    );
    expect((await reader.readLogs("prometheus", "24h")).toString("utf8")).toBe(
      "docker-log-body",
    );

    expect(requests).toEqual([
      {
        method: "GET",
        url: `/v1.40/containers/homeassistant/logs?stdout=true&stderr=true&since=${NOW_SECONDS - 900}&timestamps=true&tail=${DOCKER_BROKER_LOG_TAIL}`,
      },
      {
        method: "GET",
        url: `/v1.40/containers/prometheus/logs?stdout=true&stderr=true&since=${NOW_SECONDS - 86_400}&timestamps=true&tail=${DOCKER_BROKER_LOG_TAIL}`,
      },
    ]);
  });

  it("fails closed on oversized raw log evidence", async () => {
    const socket = await tempSocket("docker.sock");
    const fakeDocker = createServer((_incoming, response) => {
      response.statusCode = 200;
      response.end(Buffer.alloc(65));
    });
    cleanups.push(socket.cleanup, () => closeServer(fakeDocker));
    await listenUnix(fakeDocker, socket.path);

    const reader = createDockerLogReader({
      socketPath: socket.path,
      now: () => FIXED_NOW,
      maxResponseBytes: 64,
    });
    await expect(reader.readLogs("homeassistant", "15m")).rejects.toBeInstanceOf(
      DockerEngineUnavailableError,
    );
  });
});

describe("broker and typed client log transport", () => {
  it("returns raw bounded evidence only on exact GET routes", async () => {
    const socket = await tempSocket("broker.sock");
    const calls: string[] = [];
    const server = createDockerBrokerServer({
      logReader: {
        async readLogs(source, range) {
          calls.push(`${source}:${range}`);
          return Buffer.from("2026-08-19T16:29:00.000000000Z ready\n", "utf8");
        },
      },
    });
    cleanups.push(socket.cleanup, () => closeServer(server));
    await listenUnix(server, socket.path);

    const path = dockerBrokerLogsPath("homeassistant", "1h");
    const direct = await unixBufferRequest(socket.path, path);
    expect(direct.status).toBe(200);
    expect(direct.body.toString("utf8")).toContain("ready");

    const post = await unixBufferRequest(socket.path, path, "POST");
    expect(post.status).toBe(405);
    expect(post.allow).toBe("GET");

    const broker = createDockerBrokerTransport({ socketPath: socket.path });
    const viaClient = await broker.readLogs("prometheus", "6h");
    expect(viaClient.toString("utf8")).toContain("ready");
    expect(calls).toEqual(["homeassistant:1h", "prometheus:6h"]);
  });

  it("client enforces the log-response byte ceiling", async () => {
    const socket = await tempSocket("broker.sock");
    const fakeBroker = createServer((_incoming, response) => {
      response.statusCode = 200;
      response.end(Buffer.alloc(65));
    });
    cleanups.push(socket.cleanup, () => closeServer(fakeBroker));
    await listenUnix(fakeBroker, socket.path);

    const broker = createDockerBrokerTransport({ socketPath: socket.path, maxResponseBytes: 64 });
    await expect(broker.readLogs("homeassistant", "15m")).rejects.toBeInstanceOf(
      DockerBrokerRequestError,
    );
    expect(DOCKER_BROKER_LOG_MAX_RESPONSE_BYTES).toBe(512 * 1024);
  });
});
