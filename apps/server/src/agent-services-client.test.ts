import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  AgentServicesSourceError,
  createAgentServicesReader,
} from "./agent-services-client.js";

const servers: Server[] = [];
const directories: string[] = [];

async function listen(handler: Parameters<typeof createServer>[0]) {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-services-"));
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
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const payload = {
  observedAt: "2026-08-15T15:00:00.000Z",
  services: [
    {
      unitId: "docker.service",
      label: "Docker Engine",
      loadState: "LOADED",
      activeState: "ACTIVE",
      subState: "running",
      enablement: "ENABLED",
      restartCount: 0,
      stateAgeSeconds: 120,
    },
  ],
};

describe("Phase 5A agent services Unix-socket client", () => {
  it("reads only the fixed services path and validates the normalized response", async () => {
    let seenPath = "";
    const socketPath = await listen((request, response) => {
      seenPath = request.url ?? "";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });

    const reader = createAgentServicesReader({ socketPath });
    await expect(reader()).resolves.toEqual(payload);
    expect(seenPath).toBe("/v1/services");
  });

  it("fails closed on non-200, malformed and oversized agent responses", async () => {
    const non200Socket = await listen((_request, response) => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end('{"private":"detail"}');
    });
    await expect(createAgentServicesReader({ socketPath: non200Socket })()).rejects.toBeInstanceOf(AgentServicesSourceError);

    const malformedSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"observedAt":');
    });
    await expect(createAgentServicesReader({ socketPath: malformedSocket })()).rejects.toBeInstanceOf(AgentServicesSourceError);

    const oversizedSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...payload, padding: "x".repeat(2_000) }));
    });
    await expect(
      createAgentServicesReader({ socketPath: oversizedSocket, maxBytes: 1_024 })(),
    ).rejects.toBeInstanceOf(AgentServicesSourceError);
  });

  it("bounds a stalled agent request and rejects unsafe socket configuration", async () => {
    const socketPath = await listen(() => {
      // Intentionally leave the response open until the client timeout destroys the request.
    });
    await expect(
      createAgentServicesReader({ socketPath, timeoutMs: 20 })(),
    ).rejects.toBeInstanceOf(AgentServicesSourceError);

    expect(() => createAgentServicesReader({ socketPath: "relative.sock" })).toThrow(TypeError);
    expect(() => createAgentServicesReader({ socketPath: `/tmp/${"x".repeat(120)}` })).toThrow(TypeError);
  });
});
