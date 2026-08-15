import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type RequestListener, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AGENT_MAINTENANCE_EVENTS_PATH,
  AgentMaintenanceEventsSourceError,
  createAgentMaintenanceEventsReader,
} from "./agent-maintenance-events-client.js";

const servers: Server[] = [];
const directories: string[] = [];

async function listen(handler: RequestListener) {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-maintenance-client-"));
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
  observedAt: "2026-08-15T19:00:00.000Z",
  events: [
    {
      invocationId: "0123456789abcdef0123456789abcdef",
      occurredAt: "2026-08-15T18:30:00.123Z",
      result: "SUCCESS",
      unitResult: null,
    },
    {
      invocationId: "fedcba9876543210fedcba9876543210",
      occurredAt: "2026-08-15T18:28:20.123Z",
      result: "FAILED",
      unitResult: "exit-code",
    },
  ],
};

describe("Phase 5C-C maintenance events Unix-socket client", () => {
  it("uses only the fixed agent route and validates structured evidence", async () => {
    const paths: string[] = [];
    const socketPath = await listen((request, response) => {
      paths.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });

    await expect(createAgentMaintenanceEventsReader({ socketPath })()).resolves.toEqual(payload);
    expect(paths).toEqual([AGENT_MAINTENANCE_EVENTS_PATH]);
  });

  it("fails closed on non-200, schema drift and oversized responses", async () => {
    const non200Socket = await listen((_request, response) => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end('{"private":"detail"}');
    });
    await expect(
      createAgentMaintenanceEventsReader({ socketPath: non200Socket })(),
    ).rejects.toBeInstanceOf(AgentMaintenanceEventsSourceError);

    const driftSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...payload, unit: "rpi5-update.service" }));
    });
    await expect(
      createAgentMaintenanceEventsReader({ socketPath: driftSocket })(),
    ).rejects.toBeInstanceOf(AgentMaintenanceEventsSourceError);

    const oversizedSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...payload, padding: "x".repeat(2_000) }));
    });
    await expect(
      createAgentMaintenanceEventsReader({ socketPath: oversizedSocket, maxBytes: 1_024 })(),
    ).rejects.toBeInstanceOf(AgentMaintenanceEventsSourceError);
  });

  it("rejects invalid invocation, timestamp, result correlation and ordering", async () => {
    const invalidSnapshots = [
      {
        ...payload,
        events: [{ ...payload.events[0], invocationId: "xyz" }],
      },
      {
        ...payload,
        events: [{ ...payload.events[0], occurredAt: "2026-08-15T18:30:00Z" }],
      },
      {
        ...payload,
        events: [{ ...payload.events[0], result: "SUCCESS", unitResult: "success" }],
      },
      {
        ...payload,
        events: [payload.events[1], payload.events[0]],
      },
    ];

    for (const snapshot of invalidSnapshots) {
      const socketPath = await listen((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(snapshot));
      });
      await expect(
        createAgentMaintenanceEventsReader({ socketPath })(),
      ).rejects.toBeInstanceOf(AgentMaintenanceEventsSourceError);
    }
  });

  it("bounds stalled requests and rejects unsafe socket configuration", async () => {
    const socketPath = await listen(() => {
      // Intentionally left open until the wall-clock deadline destroys the request.
    });
    await expect(
      createAgentMaintenanceEventsReader({ socketPath, timeoutMs: 20 })(),
    ).rejects.toBeInstanceOf(AgentMaintenanceEventsSourceError);

    expect(() => createAgentMaintenanceEventsReader({ socketPath: "relative.sock" })).toThrow(TypeError);
    expect(() => createAgentMaintenanceEventsReader({ socketPath: `/tmp/${"x".repeat(120)}` })).toThrow(TypeError);
  });
});
