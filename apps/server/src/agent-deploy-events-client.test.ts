import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type RequestListener, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AGENT_DEPLOY_EVENTS_PATH,
  AgentDeployEventsSourceError,
  createAgentDeployEventsReader,
} from "./agent-deploy-events-client.js";

const servers: Server[] = [];
const directories: string[] = [];

async function listen(handler: RequestListener) {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-deploy-client-"));
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

const commit = "abcdef123456";
const payload = {
  observedAt: "2026-08-15T20:00:00.000Z",
  events: [
    {
      transactionId: `20260815T195043123456Z-${commit}`,
      commit,
      occurredAt: "2026-08-15T19:51:00.123Z",
    },
  ],
};

describe("Phase 5C-D deploy events Unix-socket client", () => {
  it("uses only the fixed agent route and validates evidence", async () => {
    const paths: string[] = [];
    const socketPath = await listen((request, response) => {
      paths.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });

    await expect(createAgentDeployEventsReader({ socketPath })()).resolves.toEqual(payload);
    expect(paths).toEqual([AGENT_DEPLOY_EVENTS_PATH]);
  });

  it("fails closed on non-200, schema drift and oversized responses", async () => {
    const non200Socket = await listen((_request, response) => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end('{"private":"detail"}');
    });
    await expect(createAgentDeployEventsReader({ socketPath: non200Socket })()).rejects.toBeInstanceOf(
      AgentDeployEventsSourceError,
    );

    const driftSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...payload, statePath: "/var/lib/rpi5-deploy" }));
    });
    await expect(createAgentDeployEventsReader({ socketPath: driftSocket })()).rejects.toBeInstanceOf(
      AgentDeployEventsSourceError,
    );

    const oversizedSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...payload, padding: "x".repeat(2_000) }));
    });
    await expect(
      createAgentDeployEventsReader({ socketPath: oversizedSocket, maxBytes: 1_024 })(),
    ).rejects.toBeInstanceOf(AgentDeployEventsSourceError);
  });

  it("rejects transaction/commit mismatch and bounds stalled requests", async () => {
    const mismatchSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ...payload,
          events: [{ ...payload.events[0], commit: "111111111111" }],
        }),
      );
    });
    await expect(createAgentDeployEventsReader({ socketPath: mismatchSocket })()).rejects.toBeInstanceOf(
      AgentDeployEventsSourceError,
    );

    const stalledSocket = await listen(() => {
      // Intentionally left open until the client deadline destroys the request.
    });
    await expect(
      createAgentDeployEventsReader({ socketPath: stalledSocket, timeoutMs: 20 })(),
    ).rejects.toBeInstanceOf(AgentDeployEventsSourceError);
  });

  it("rejects unsafe socket configuration", () => {
    expect(() => createAgentDeployEventsReader({ socketPath: "relative.sock" })).toThrow(TypeError);
    expect(() => createAgentDeployEventsReader({ socketPath: `/tmp/${"x".repeat(120)}` })).toThrow(
      TypeError,
    );
  });
});
