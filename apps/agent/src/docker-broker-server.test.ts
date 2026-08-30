import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DOCKER_BROKER_CONTAINERS_PATH,
  DOCKER_BROKER_HEALTH_PATH,
  DOCKER_BROKER_PING_PATH,
  DOCKER_BROKER_VERSION_PATH,
  dockerBrokerInspectPath,
  dockerBrokerStatsPath,
} from "./docker-broker-protocol.js";
import {
  createDockerBrokerServer,
  createDockerEngineReader,
  DockerEngineHttpStatusError,
  DockerEngineUnavailableError,
  type DockerEngineReader,
} from "./docker-broker-server.js";

const ID = "a".repeat(64);
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function tempSocket(name: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(resolve(tmpdir(), "dashboard-rpi5-docker-broker-"));
  return {
    path: resolve(root, name),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function listenUnix(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolvePromise();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
}

async function unixRequest(
  socketPath: string,
  path: string,
  options: { method?: string; body?: string } = {},
): Promise<{ status: number; body: unknown; allow: string | undefined }> {
  const body = options.body ?? "";
  return new Promise((resolvePromise, reject) => {
    const req = request(
      {
        socketPath,
        path,
        method: options.method ?? "GET",
        headers: body === "" ? undefined : { "content-length": Buffer.byteLength(body) },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("error", reject);
        response.once("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = null;
          if (raw !== "") parsed = JSON.parse(raw) as unknown;
          resolvePromise({
            status: response.statusCode ?? 0,
            body: parsed,
            allow: typeof response.headers.allow === "string" ? response.headers.allow : undefined,
          });
        });
      },
    );
    req.once("error", reject);
    if (body !== "") req.write(body);
    req.end();
  });
}

function healthyReader(calls: string[] = []): DockerEngineReader {
  return {
    async ping() {
      calls.push("ping");
    },
    async version() {
      calls.push("version");
      return { Version: "29.6.1", ApiVersion: "1.55", MinAPIVersion: "1.40" };
    },
    async listContainers() {
      calls.push("containers");
      return [{ Id: ID }];
    },
    async inspectContainer(id) {
      calls.push(`inspect:${id}`);
      return { Id: id };
    },
    async statsContainer(id) {
      calls.push(`stats:${id}`);
      return { id };
    },
  };
}

describe("bounded Docker broker HTTP contract", () => {
  it("accepts exact GET capabilities and rejects mutation, arbitrary paths and request bodies", async () => {
    const socket = await tempSocket("broker.sock");
    const calls: string[] = [];
    const server = createDockerBrokerServer({ engineReader: healthyReader(calls) });
    cleanups.push(socket.cleanup, () => closeServer(server));
    await listenUnix(server, socket.path);

    expect(await unixRequest(socket.path, DOCKER_BROKER_HEALTH_PATH)).toMatchObject({
      status: 200,
      body: { status: "ok", service: "dashboard-rpi5-docker-broker" },
    });
    expect(await unixRequest(socket.path, DOCKER_BROKER_PING_PATH)).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect((await unixRequest(socket.path, DOCKER_BROKER_VERSION_PATH)).status).toBe(200);
    expect((await unixRequest(socket.path, DOCKER_BROKER_CONTAINERS_PATH)).status).toBe(200);
    expect((await unixRequest(socket.path, dockerBrokerInspectPath(ID))).status).toBe(200);
    expect((await unixRequest(socket.path, dockerBrokerStatsPath(ID))).status).toBe(200);

    const post = await unixRequest(socket.path, DOCKER_BROKER_VERSION_PATH, { method: "POST" });
    expect(post).toMatchObject({ status: 405, body: { error: "METHOD_NOT_ALLOWED" }, allow: "GET" });
    expect((await unixRequest(socket.path, `/v1/docker/containers/${ID}/stop`)).status).toBe(404);
    expect((await unixRequest(socket.path, `${DOCKER_BROKER_CONTAINERS_PATH}?all=false`)).status).toBe(404);
    expect((await unixRequest(socket.path, "/v1/docker/containers/../version")).status).toBe(404);
    expect(
      await unixRequest(socket.path, DOCKER_BROKER_VERSION_PATH, { body: "{}" }),
    ).toMatchObject({ status: 400, body: { error: "INVALID_REQUEST" } });

    expect(calls).toEqual([
      "ping",
      "version",
      "containers",
      `inspect:${ID}`,
      `stats:${ID}`,
    ]);
  });

  it("maps only disappearing inspect/stats objects to 404 without exposing engine errors", async () => {
    const socket = await tempSocket("broker.sock");
    const reader = healthyReader();
    reader.inspectContainer = async () => {
      throw new DockerEngineHttpStatusError(404);
    };
    reader.statsContainer = async () => {
      throw new DockerEngineHttpStatusError(500);
    };
    const server = createDockerBrokerServer({ engineReader: reader });
    cleanups.push(socket.cleanup, () => closeServer(server));
    await listenUnix(server, socket.path);

    expect(await unixRequest(socket.path, dockerBrokerInspectPath(ID))).toMatchObject({
      status: 404,
      body: { error: "NOT_FOUND" },
    });
    expect(await unixRequest(socket.path, dockerBrokerStatsPath(ID))).toMatchObject({
      status: 503,
      body: { error: "SOURCE_UNAVAILABLE" },
    });
  });

  it("rejects work beyond the configured concurrency bound", async () => {
    const socket = await tempSocket("broker.sock");
    let releaseVersion!: () => void;
    let versionStarted!: () => void;
    const started = new Promise<void>((resolvePromise) => {
      versionStarted = resolvePromise;
    });
    const held = new Promise<void>((resolvePromise) => {
      releaseVersion = resolvePromise;
    });
    const reader = healthyReader();
    reader.version = async () => {
      versionStarted();
      await held;
      return { Version: "29.6.1", ApiVersion: "1.55", MinAPIVersion: "1.40" };
    };

    const server = createDockerBrokerServer({ engineReader: reader, maxConcurrentRequests: 1 });
    cleanups.push(socket.cleanup, () => closeServer(server));
    await listenUnix(server, socket.path);

    const first = unixRequest(socket.path, DOCKER_BROKER_VERSION_PATH);
    await started;
    expect(await unixRequest(socket.path, DOCKER_BROKER_CONTAINERS_PATH)).toMatchObject({
      status: 503,
      body: { error: "SOURCE_UNAVAILABLE" },
    });
    releaseVersion();
    expect((await first).status).toBe(200);
  });
});

describe("Docker Engine reader authority", () => {
  it("constructs only negotiated hard-coded GET paths on an isolated fake Docker Unix socket", async () => {
    const socket = await tempSocket("docker.sock");
    const requests: Array<{ method: string | undefined; url: string | undefined }> = [];
    const fakeDocker = createServer((incoming, response) => {
      requests.push({ method: incoming.method, url: incoming.url });
      const url = incoming.url ?? "";
      response.setHeader("content-type", "application/json");
      if (url === "/version") {
        response.end(JSON.stringify({ Version: "29.6.1", ApiVersion: "1.55", MinAPIVersion: "1.40" }));
        return;
      }
      if (url === "/v1.55/_ping") {
        response.removeHeader("content-type");
        response.end("OK");
        return;
      }
      if (url === "/v1.55/version") {
        response.end(JSON.stringify({ Version: "29.6.1", ApiVersion: "1.55", MinAPIVersion: "1.40" }));
        return;
      }
      if (url === "/v1.55/containers/json?all=true") {
        response.end(JSON.stringify([{ Id: ID }]));
        return;
      }
      if (url === `/v1.55/containers/${ID}/json`) {
        response.end(JSON.stringify({ Id: ID }));
        return;
      }
      if (url === `/v1.55/containers/${ID}/stats?stream=false`) {
        response.end(JSON.stringify({ cpu_stats: {} }));
        return;
      }
      response.statusCode = 500;
      response.end(JSON.stringify({ message: "unexpected" }));
    });
    cleanups.push(socket.cleanup, () => closeServer(fakeDocker));
    await listenUnix(fakeDocker, socket.path);

    const reader = createDockerEngineReader({ socketPath: socket.path });
    await reader.ping();
    await reader.version();
    await reader.listContainers();
    await reader.inspectContainer(ID);
    await reader.statsContainer(ID);

    expect(requests).toEqual([
      { method: "GET", url: "/version" },
      { method: "GET", url: "/v1.55/_ping" },
      { method: "GET", url: "/v1.55/version" },
      { method: "GET", url: "/v1.55/containers/json?all=true" },
      { method: "GET", url: `/v1.55/containers/${ID}/json` },
      { method: "GET", url: `/v1.55/containers/${ID}/stats?stream=false` },
    ]);
    await expect(reader.inspectContainer("../etc/passwd")).rejects.toBeInstanceOf(
      DockerEngineUnavailableError,
    );
    expect(requests).toHaveLength(6);
  });

  it("fails closed on oversized and timed-out Engine evidence", async () => {
    const oversizedSocket = await tempSocket("oversized.sock");
    const oversized = createServer((_incoming, response) => {
      response.end(JSON.stringify({ payload: "x".repeat(128) }));
    });
    cleanups.push(oversizedSocket.cleanup, () => closeServer(oversized));
    await listenUnix(oversized, oversizedSocket.path);

    await expect(
      createDockerEngineReader({ socketPath: oversizedSocket.path, maxResponseBytes: 32 }).version(),
    ).rejects.toBeInstanceOf(DockerEngineUnavailableError);

    const timeoutSocket = await tempSocket("timeout.sock");
    const timeout = createServer(() => undefined);
    cleanups.push(timeoutSocket.cleanup, () => closeServer(timeout));
    await listenUnix(timeout, timeoutSocket.path);

    await expect(
      createDockerEngineReader({ socketPath: timeoutSocket.path, requestTimeoutMs: 75 }).version(),
    ).rejects.toBeInstanceOf(DockerEngineUnavailableError);
  });
});
