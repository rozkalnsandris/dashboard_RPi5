import { afterEach, describe, expect, it } from "vitest";
import { createServer, type RequestListener, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  AgentCurrentStateSourceError,
  createAgentDockerContainersReader,
  createAgentHostSummaryReader,
} from "./agent-current-state-client.js";

const servers: Server[] = [];
const directories: string[] = [];

async function listen(handler: RequestListener) {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-current-state-"));
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
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const hostPayload = {
  observedAt: "2026-08-17T18:00:00.000Z",
  uptimeSeconds: 321_000,
  loadAverage: { oneMinute: 0.42, fiveMinutes: 0.37, fifteenMinutes: 0.31 },
  cpu: { usagePercent: 12.5, sampleWindowMs: 250 },
  memory: {
    totalBytes: 8_589_934_592,
    availableBytes: 5_368_709_120,
    usedBytes: 3_221_225_472,
    usedPercent: 37.5,
    swapTotalBytes: 536_870_912,
    swapFreeBytes: 536_870_912,
    swapUsedBytes: 0,
    swapUsedPercent: 0,
  },
  filesystem: {
    path: "/",
    totalBytes: 256_000_000_000,
    availableBytes: 151_000_000_000,
    usedBytes: 105_000_000_000,
    usedPercent: 41.0,
  },
  temperature: { celsius: 43.1 },
  throttle: {
    rawHex: "0x0",
    rawValue: 0,
    current: { underVoltage: false, armFrequencyCapped: false, throttled: false, softTemperatureLimit: false },
    occurred: { underVoltage: false, armFrequencyCapped: false, throttled: false, softTemperatureLimit: false },
  },
};

const dockerPayload = {
  observedAt: "2026-08-17T18:00:00.000Z",
  apiVersion: "1.40",
  engineVersion: "28.3.3",
  daemonApiVersion: "1.51",
  daemonMinApiVersion: "1.24",
  containers: [
    {
      id: "a".repeat(64),
      name: "homeassistant",
      image: "ghcr.io/home-assistant/home-assistant:stable",
      imageId: "sha256:test",
      createdAt: "2026-08-01T00:00:00.000Z",
      state: "RUNNING",
      health: "HEALTHY",
      restartCount: 0,
      startedAt: "2026-08-05T00:00:00.000Z",
      uptimeSeconds: 1_080_000,
      statsState: "AVAILABLE",
      stats: {
        cpuPercent: 6.8,
        memoryUsedBytes: 654_311_424,
        memoryLimitBytes: 8_589_934_592,
        memoryPercent: 7.6,
        networkRxBytes: 77_594_624,
        networkTxBytes: 18_874_368,
        blockReadBytes: 20_000_000,
        blockWriteBytes: 5_000_000,
        pids: 24,
      },
    },
  ],
};

describe("current-state agent Unix-socket clients", () => {
  it("uses only the fixed host and Docker paths and validates both payloads", async () => {
    const seen: string[] = [];
    const socketPath = await listen((request, response) => {
      seen.push(request.url ?? "");
      const payload = request.url === "/v1/host/summary" ? hostPayload : dockerPayload;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });

    await expect(createAgentHostSummaryReader({ socketPath })()).resolves.toEqual(hostPayload);
    await expect(createAgentDockerContainersReader({ socketPath })()).resolves.toEqual(dockerPayload);
    expect(seen).toEqual(["/v1/host/summary", "/v1/docker/containers"]);
  });

  it("fails closed on non-200, malformed and oversized responses", async () => {
    const non200Socket = await listen((_request, response) => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end('{"private":"detail"}');
    });
    await expect(createAgentHostSummaryReader({ socketPath: non200Socket })()).rejects.toBeInstanceOf(AgentCurrentStateSourceError);

    const malformedSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"observedAt":');
    });
    await expect(createAgentDockerContainersReader({ socketPath: malformedSocket })()).rejects.toBeInstanceOf(AgentCurrentStateSourceError);

    const oversizedSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...dockerPayload, padding: "x".repeat(2_000) }));
    });
    await expect(
      createAgentDockerContainersReader({ socketPath: oversizedSocket, maxBytes: 1_024 })(),
    ).rejects.toBeInstanceOf(AgentCurrentStateSourceError);
  });

  it("bounds stalled requests and rejects unsafe socket configuration", async () => {
    const socketPath = await listen(() => {
      // Leave the response open until the bounded client timeout destroys it.
    });
    await expect(
      createAgentHostSummaryReader({ socketPath, timeoutMs: 20 })(),
    ).rejects.toBeInstanceOf(AgentCurrentStateSourceError);

    expect(() => createAgentHostSummaryReader({ socketPath: "relative.sock" })).toThrow(TypeError);
    expect(() => createAgentDockerContainersReader({ socketPath: `/tmp/${"x".repeat(120)}` })).toThrow(TypeError);
  });
});
