import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDockerEventReader } from "./docker-broker-events.js";
import {
  createDockerEngineReader,
  createDockerLogReader,
  DockerEngineUnavailableError,
} from "./docker-broker-server.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function tempSocket(name: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(resolve(tmpdir(), "dashboard-rpi5-docker-api-negotiation-"));
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

function sendJson(response: ServerResponse, value: unknown, statusCode = 200) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
}

async function withDockerSocket(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const socket = await tempSocket("docker.sock");
  const server = createServer(handler);
  cleanups.push(socket.cleanup, () => closeServer(server));
  await listenUnix(server, socket.path);
  return socket.path;
}

describe("Docker Engine API negotiation integration", () => {
  it("discovers once and uses the preferred supported version for typed engine reads", async () => {
    const paths: string[] = [];
    const socketPath = await withDockerSocket((request, response) => {
      paths.push(request.url ?? "");
      if (request.url === "/version") {
        sendJson(response, { Version: "29.7.0", ApiVersion: "1.55", MinAPIVersion: "1.40" });
        return;
      }
      if (request.url === "/v1.55/_ping") {
        response.end("OK");
        return;
      }
      if (request.url === "/v1.55/containers/json?all=true") {
        sendJson(response, []);
        return;
      }
      response.statusCode = 404;
      response.end();
    });

    const reader = createDockerEngineReader({ socketPath });
    await reader.ping();
    expect(await reader.listContainers()).toEqual([]);
    expect(await reader.version()).toMatchObject({ ApiVersion: "1.55", MinAPIVersion: "1.40" });

    expect(paths).toEqual([
      "/version",
      "/v1.55/_ping",
      "/v1.55/containers/json?all=true",
    ]);
  });

  it("uses the highest supported overlap when the daemon maximum is below preferred", async () => {
    const paths: string[] = [];
    const socketPath = await withDockerSocket((request, response) => {
      paths.push(request.url ?? "");
      if (request.url === "/version") {
        sendJson(response, { Version: "26.0.0", ApiVersion: "1.48", MinAPIVersion: "1.42" });
        return;
      }
      if (request.url === "/v1.48/containers/json?all=true") {
        sendJson(response, []);
        return;
      }
      response.statusCode = 404;
      response.end();
    });

    const reader = createDockerEngineReader({ socketPath });
    expect(await reader.listContainers()).toEqual([]);
    expect(paths).toEqual(["/version", "/v1.48/containers/json?all=true"]);
  });

  it("fails closed on malformed discovery without issuing a versioned Engine request", async () => {
    const paths: string[] = [];
    const socketPath = await withDockerSocket((request, response) => {
      paths.push(request.url ?? "");
      sendJson(response, { ApiVersion: "1.55/containers/json", MinAPIVersion: "1.40" });
    });

    const reader = createDockerEngineReader({ socketPath });
    await expect(reader.listContainers()).rejects.toBeInstanceOf(DockerEngineUnavailableError);
    expect(paths).toEqual(["/version"]);
  });

  it("invalidates after failure but does not retry the failed operation in the same call", async () => {
    const paths: string[] = [];
    let containersAttempts = 0;
    const socketPath = await withDockerSocket((request, response) => {
      paths.push(request.url ?? "");
      if (request.url === "/version") {
        sendJson(response, { Version: "29.7.0", ApiVersion: "1.55", MinAPIVersion: "1.40" });
        return;
      }
      if (request.url === "/v1.55/containers/json?all=true") {
        containersAttempts += 1;
        if (containersAttempts === 1) {
          sendJson(response, { message: "temporary failure" }, 500);
          return;
        }
        sendJson(response, []);
        return;
      }
      response.statusCode = 404;
      response.end();
    });

    const reader = createDockerEngineReader({ socketPath });
    await expect(reader.listContainers()).rejects.toBeInstanceOf(DockerEngineUnavailableError);
    expect(paths).toEqual(["/version", "/v1.55/containers/json?all=true"]);

    expect(await reader.listContainers()).toEqual([]);
    expect(paths).toEqual([
      "/version",
      "/v1.55/containers/json?all=true",
      "/version",
      "/v1.55/containers/json?all=true",
    ]);
  });

  it("uses negotiated prefixes for fixed log and event routes", async () => {
    const paths: string[] = [];
    const socketPath = await withDockerSocket((request, response) => {
      paths.push(request.url ?? "");
      if (request.url === "/version") {
        sendJson(response, { Version: "29.7.0", ApiVersion: "1.55", MinAPIVersion: "1.40" });
        return;
      }
      if (request.url?.startsWith("/v1.55/containers/prometheus/logs?")) {
        response.end("line\n");
        return;
      }
      if (request.url?.startsWith("/v1.55/events?")) {
        response.end('{"Type":"container"}\n');
        return;
      }
      response.statusCode = 404;
      response.end();
    });

    const logReader = createDockerLogReader({
      socketPath,
      now: () => new Date("2026-08-30T12:00:00.000Z"),
    });
    const eventReader = createDockerEventReader({ socketPath });

    expect((await logReader.readLogs("prometheus", "1h")).toString("utf8")).toBe("line\n");
    expect(await eventReader.readEvents(100, 200)).toEqual([{ Type: "container" }]);

    expect(paths.filter((path) => path === "/version")).toHaveLength(2);
    expect(paths.some((path) => path.startsWith("/v1.55/containers/prometheus/logs?"))).toBe(true);
    expect(paths.some((path) => path.startsWith("/v1.55/events?"))).toBe(true);
    expect(paths.some((path) => path.includes("/v1.40/"))).toBe(false);
  });
});
