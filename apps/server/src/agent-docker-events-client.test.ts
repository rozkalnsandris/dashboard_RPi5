import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type RequestListener, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AGENT_DOCKER_EVENTS_PATH,
  AgentDockerEventsSourceError,
  createAgentDockerEventsReader,
} from "./agent-docker-events-client.js";

const servers: Server[] = [];
const directories: string[] = [];

async function listen(handler: RequestListener) {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-docker-events-"));
  const socketPath = join(directory, "agent.sock");
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  servers.push(server);
  directories.push(directory);
  return socketPath;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const payload = {
  observedAt: "2026-08-15T17:00:00.000Z",
  windowStart: "2026-08-15T16:00:00.000Z",
  windowEnd: "2026-08-15T17:00:00.000Z",
  apiVersion: "1.40",
  events: [
    {
      occurredAt: "2026-08-15T16:59:00.000Z",
      action: "START",
      containerId: "a".repeat(64),
      containerName: "homeassistant",
      image: "homeassistant/home-assistant:stable",
      health: null,
      exitCode: null,
      signal: null,
      scope: "LOCAL",
    },
  ],
};

describe("Phase 5C-A Docker events Unix-socket client", () => {
  it("uses only the fixed agent path and validates the bounded response", async () => {
    const paths: string[] = [];
    const socketPath = await listen((request, response) => {
      paths.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });

    await expect(createAgentDockerEventsReader({ socketPath })()).resolves.toEqual(payload);
    expect(paths).toEqual([AGENT_DOCKER_EVENTS_PATH]);
  });

  it("fails closed on non-200, schema drift and oversized responses", async () => {
    const non200Socket = await listen((_request, response) => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end('{"private":"detail"}');
    });
    await expect(createAgentDockerEventsReader({ socketPath: non200Socket })()).rejects.toBeInstanceOf(
      AgentDockerEventsSourceError,
    );

    const driftSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...payload, path: "/var/run/docker.sock" }));
    });
    await expect(createAgentDockerEventsReader({ socketPath: driftSocket })()).rejects.toBeInstanceOf(
      AgentDockerEventsSourceError,
    );

    const oversizedSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...payload, padding: "x".repeat(2_000) }));
    });
    await expect(
      createAgentDockerEventsReader({ socketPath: oversizedSocket, maxBytes: 1_024 })(),
    ).rejects.toBeInstanceOf(AgentDockerEventsSourceError);
  });

  it("bounds stalled requests and rejects unsafe socket configuration", async () => {
    const socketPath = await listen(() => {
      // Intentionally left open until the wall-clock deadline destroys the request.
    });
    await expect(
      createAgentDockerEventsReader({ socketPath, timeoutMs: 20 })(),
    ).rejects.toBeInstanceOf(AgentDockerEventsSourceError);

    expect(() => createAgentDockerEventsReader({ socketPath: "relative.sock" })).toThrow(TypeError);
    expect(() => createAgentDockerEventsReader({ socketPath: `/tmp/${"x".repeat(120)}` })).toThrow(TypeError);
  });
});
