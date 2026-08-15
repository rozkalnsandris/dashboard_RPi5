import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type RequestListener, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentLogsSourceError,
  createAgentLogsReaders,
} from "./agent-logs-client.js";

const servers: Server[] = [];
const directories: string[] = [];

async function listen(handler: RequestListener) {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-logs-"));
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

const sourcesPayload = {
  observedAt: "2026-08-15T15:00:00.000Z",
  sources: [
    {
      sourceId: "systemd:docker",
      label: "Docker Engine",
      kind: "SYSTEMD",
      rangeMode: "TIME",
    },
  ],
};

const logsPayload = {
  observedAt: "2026-08-15T15:00:00.000Z",
  source: sourcesPayload.sources[0],
  range: "1h",
  rangeApplied: true,
  entries: [
    {
      sequence: 0,
      timestamp: "2026-08-15T14:59:00.000Z",
      level: "INFO",
      stream: "JOURNAL",
      message: "Docker daemon ready",
    },
  ],
  truncated: false,
};

describe("Phase 5B agent logs Unix-socket client", () => {
  it("reads only fixed source/log paths and validates normalized responses", async () => {
    const paths: string[] = [];
    const socketPath = await listen((request, response) => {
      paths.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      if (request.url === "/v1/logs/sources") {
        response.end(JSON.stringify(sourcesPayload));
        return;
      }
      response.end(JSON.stringify(logsPayload));
    });

    const readers = createAgentLogsReaders({ socketPath });
    await expect(readers.readSources()).resolves.toEqual(sourcesPayload);
    await expect(readers.readLogs("systemd:docker", "1h")).resolves.toEqual(logsPayload);
    expect(paths).toEqual([
      "/v1/logs/sources",
      "/v1/logs?sourceId=systemd%3Adocker&range=1h",
    ]);
  });

  it("fails closed on non-200, malformed and oversized agent responses", async () => {
    const non200Socket = await listen((_request, response) => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end('{"private":"detail"}');
    });
    await expect(
      createAgentLogsReaders({ socketPath: non200Socket }).readSources(),
    ).rejects.toBeInstanceOf(AgentLogsSourceError);

    const malformedSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"observedAt":');
    });
    await expect(
      createAgentLogsReaders({ socketPath: malformedSocket }).readSources(),
    ).rejects.toBeInstanceOf(AgentLogsSourceError);

    const oversizedSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...sourcesPayload, padding: "x".repeat(2_000) }));
    });
    await expect(
      createAgentLogsReaders({ socketPath: oversizedSocket, maxBytes: 1_024 }).readSources(),
    ).rejects.toBeInstanceOf(AgentLogsSourceError);
  });

  it("rejects schema drift even when the JSON response is syntactically valid", async () => {
    const socketPath = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...logsPayload, source: { ...logsPayload.source, path: "/etc/shadow" } }));
    });
    await expect(
      createAgentLogsReaders({ socketPath }).readLogs("systemd:docker", "1h"),
    ).rejects.toBeInstanceOf(AgentLogsSourceError);
  });

  it("bounds stalled agent requests and rejects unsafe socket configuration", async () => {
    const socketPath = await listen(() => {
      // Intentionally left open until the wall-clock deadline destroys the request.
    });
    await expect(
      createAgentLogsReaders({ socketPath, timeoutMs: 20 }).readSources(),
    ).rejects.toBeInstanceOf(AgentLogsSourceError);

    expect(() => createAgentLogsReaders({ socketPath: "relative.sock" })).toThrow(TypeError);
    expect(() => createAgentLogsReaders({ socketPath: `/tmp/${"x".repeat(120)}` })).toThrow(TypeError);
  });
});
