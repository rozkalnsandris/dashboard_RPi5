import { mkdtemp, rm } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createDockerBrokerTransport,
  DockerBrokerRequestError,
} from "./docker-broker-client.js";
import {
  DOCKER_BROKER_CONTAINERS_PATH,
  DOCKER_BROKER_PING_PATH,
  DOCKER_BROKER_VERSION_PATH,
  dockerBrokerInspectPath,
  dockerBrokerStatsPath,
} from "./docker-broker-protocol.js";

const ID = "a".repeat(64);
const cleanups: Array<() => Promise<void>> = [];

type RequestListener = (request: IncomingMessage, response: ServerResponse) => void;

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function withUnixServer(
  handler: RequestListener,
): Promise<{ socketPath: string; server: Server }> {
  const root = await mkdtemp(resolve(tmpdir(), "dashboard-rpi5-broker-client-"));
  const socketPath = resolve(root, "broker.sock");
  const server = createServer(handler);
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolvePromise);
  });
  cleanups.push(
    () => rm(root, { recursive: true, force: true }),
    () => new Promise<void>((resolvePromise) => server.close(() => resolvePromise())),
  );
  return { socketPath, server };
}

describe("typed Docker broker client", () => {
  it("emits only the fixed GET capability routes", async () => {
    const seen: Array<{ method: string | undefined; url: string | undefined }> = [];
    const { socketPath } = await withUnixServer((request, response) => {
      seen.push({ method: request.method, url: request.url });
      response.setHeader("content-type", "application/json");
      if (request.url === DOCKER_BROKER_PING_PATH) response.end('{"ok":true}');
      else response.end("{}");
    });
    const broker = createDockerBrokerTransport({ socketPath });

    await broker.ping();
    await broker.version();
    await broker.listContainers();
    await broker.inspectContainer(ID);
    await broker.statsContainer(ID);

    expect(seen).toEqual([
      { method: "GET", url: DOCKER_BROKER_PING_PATH },
      { method: "GET", url: DOCKER_BROKER_VERSION_PATH },
      { method: "GET", url: DOCKER_BROKER_CONTAINERS_PATH },
      { method: "GET", url: dockerBrokerInspectPath(ID) },
      { method: "GET", url: dockerBrokerStatsPath(ID) },
    ]);
    await expect(broker.inspectContainer("../etc/passwd")).rejects.toBeInstanceOf(
      DockerBrokerRequestError,
    );
    expect(seen).toHaveLength(5);
  });

  it("preserves broker 404 for disappearing-container semantics", async () => {
    const { socketPath } = await withUnixServer((_request, response) => {
      response.statusCode = 404;
      response.end('{"error":"NOT_FOUND"}');
    });
    const broker = createDockerBrokerTransport({ socketPath });

    await expect(broker.inspectContainer(ID)).rejects.toMatchObject({
      name: "DockerBrokerRequestError",
      statusCode: 404,
    });
  });

  it("fails closed on oversized and timed-out broker evidence without leaking an extra error", async () => {
    const oversized = await withUnixServer((_request, response) => {
      response.end(JSON.stringify({ payload: "x".repeat(128) }));
    });
    await expect(
      createDockerBrokerTransport({ socketPath: oversized.socketPath, maxResponseBytes: 32 }).version(),
    ).rejects.toBeInstanceOf(DockerBrokerRequestError);

    const timeout = await withUnixServer(() => undefined);
    await expect(
      createDockerBrokerTransport({ socketPath: timeout.socketPath, requestTimeoutMs: 75 }).version(),
    ).rejects.toBeInstanceOf(DockerBrokerRequestError);
  });
});
