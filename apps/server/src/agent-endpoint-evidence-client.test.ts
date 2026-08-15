import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type RequestListener, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AGENT_ENDPOINT_EVENTS_PATH,
  AgentEndpointEvidenceSourceError,
  createAgentEndpointEvidenceReader,
} from "./agent-endpoint-evidence-client.js";

const servers: Server[] = [];
const directories: string[] = [];

async function listen(handler: RequestListener) {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-endpoint-client-"));
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
  observedAt: "2026-08-15T20:00:00.000Z",
  schema: "dashboard-rpi5.endpoint-evidence.v1",
  events: [
    {
      eventId: "tech-down-20260815T195100Z",
      endpointId: "tech",
      label: "Hermes Tech",
      occurredAt: "2026-08-15T19:51:00.123Z",
      fromState: "UP",
      toState: "DOWN",
      statusCode: 503,
      latencyMs: 1500,
    },
  ],
};

describe("Phase 5C-E endpoint evidence Unix-socket client", () => {
  it("uses only the fixed agent route and validates evidence", async () => {
    const paths: string[] = [];
    const socketPath = await listen((request, response) => {
      paths.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });

    await expect(createAgentEndpointEvidenceReader({ socketPath })()).resolves.toEqual(payload);
    expect(paths).toEqual([AGENT_ENDPOINT_EVENTS_PATH]);
  });

  it("fails closed on non-200, schema drift and oversized responses", async () => {
    const non200Socket = await listen((_request, response) => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end('{"private":"detail"}');
    });
    await expect(
      createAgentEndpointEvidenceReader({ socketPath: non200Socket })(),
    ).rejects.toBeInstanceOf(AgentEndpointEvidenceSourceError);

    const driftSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...payload, probeUrl: "https://secret.example.invalid" }));
    });
    await expect(
      createAgentEndpointEvidenceReader({ socketPath: driftSocket })(),
    ).rejects.toBeInstanceOf(AgentEndpointEvidenceSourceError);

    const oversizedSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...payload, padding: "x".repeat(2_000) }));
    });
    await expect(
      createAgentEndpointEvidenceReader({ socketPath: oversizedSocket, maxBytes: 1_024 })(),
    ).rejects.toBeInstanceOf(AgentEndpointEvidenceSourceError);
  });

  it("rejects semantic drift and bounds stalled requests", async () => {
    const noOpSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ...payload,
          events: [{ ...payload.events[0], fromState: "DOWN", toState: "DOWN" }],
        }),
      );
    });
    await expect(
      createAgentEndpointEvidenceReader({ socketPath: noOpSocket })(),
    ).rejects.toBeInstanceOf(AgentEndpointEvidenceSourceError);

    const stalledSocket = await listen(() => {
      // Intentionally left open until the client deadline destroys the request.
    });
    await expect(
      createAgentEndpointEvidenceReader({ socketPath: stalledSocket, timeoutMs: 20 })(),
    ).rejects.toBeInstanceOf(AgentEndpointEvidenceSourceError);
  });

  it("rejects unsafe socket configuration", () => {
    expect(() => createAgentEndpointEvidenceReader({ socketPath: "relative.sock" })).toThrow(
      TypeError,
    );
    expect(() =>
      createAgentEndpointEvidenceReader({ socketPath: `/tmp/${"x".repeat(120)}` }),
    ).toThrow(TypeError);
  });
});
