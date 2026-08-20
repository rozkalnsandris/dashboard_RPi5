import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { dockerBrokerEventsPath } from "./docker-broker-protocol.js";
import { createDockerBrokerServer, type DockerEngineReader } from "./docker-broker-server.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function unusedEngineReader(): DockerEngineReader {
  const unavailable = async () => {
    throw new Error("unexpected engine reader call");
  };
  return {
    ping: unavailable,
    version: unavailable,
    listContainers: unavailable,
    inspectContainer: unavailable,
    statsContainer: unavailable,
  };
}

async function requestJson(socketPath: string, path: string) {
  return new Promise<{ status: number; body: unknown }>((resolvePromise, reject) => {
    const req = request({ socketPath, path, method: "GET" }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => {
        resolvePromise({
          status: response.statusCode ?? 0,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
        });
      });
    });
    req.once("error", reject);
    req.end();
  });
}

describe("Docker broker recent-events dispatch", () => {
  it("dispatches only the validated numeric window to the dedicated event reader", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "dashboard-rpi5-event-broker-"));
    const socketPath = resolve(root, "broker.sock");
    const readEvents = vi.fn(async () => [{ Type: "container", Action: "start" }]);
    const server = createDockerBrokerServer({
      engineReader: unusedEngineReader(),
      eventReader: { readEvents },
    });
    cleanups.push(
      () => rm(root, { recursive: true, force: true }),
      () => new Promise<void>((resolvePromise) => server.close(() => resolvePromise())),
    );
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolvePromise);
    });

    expect(await requestJson(socketPath, dockerBrokerEventsPath(100, 200))).toEqual({
      status: 200,
      body: [{ Type: "container", Action: "start" }],
    });
    expect(readEvents).toHaveBeenCalledTimes(1);
    expect(readEvents).toHaveBeenCalledWith(100, 200, expect.any(AbortSignal));

    expect(
      (await requestJson(socketPath, "/v1/docker/events/recent?since=100&until=200&filters=%7B%7D")).status,
    ).toBe(404);
    expect(readEvents).toHaveBeenCalledTimes(1);
  });
});
