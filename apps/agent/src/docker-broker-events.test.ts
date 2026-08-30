import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createDockerEventReader,
  DockerBrokerEventsSourceError,
} from "./docker-broker-events.js";
import { DOCKER_EVENT_FILTER_ACTIONS } from "./docker-events.js";

const cleanups: Array<() => Promise<void>> = [];

function sendVersion(response: import("node:http").ServerResponse) {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ Version: "29.6.1", ApiVersion: "1.55", MinAPIVersion: "1.40" }));
}

async function tempSocket(name: string) {
  const root = await mkdtemp(resolve(tmpdir(), "dashboard-rpi5-events-"));
  return { path: resolve(root, name), cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function listenUnix(server: Server, path: string) {
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(path, resolvePromise);
  });
}

async function closeServer(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
}

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

describe("bounded Docker Engine event reader", () => {
  it("uses only the fixed negotiated GET events path and parses chunked JSON event frames", async () => {
    const socket = await tempSocket("docker.sock");
    const requests: Array<{ method: string | undefined; url: string | undefined }> = [];
    const fakeDocker = createServer((incoming, response) => {
      requests.push({ method: incoming.method, url: incoming.url });
      if (incoming.url === "/version") {
        sendVersion(response);
        return;
      }
      const first = JSON.stringify({ Type: "container", Action: "start", n: 1 });
      const second = JSON.stringify({ Type: "container", Action: "stop", n: 2 });
      const payload = Buffer.from(`${first}\n${second}\n`, "utf8");
      response.write(payload.subarray(0, 17));
      response.write(payload.subarray(17, 43));
      response.end(payload.subarray(43));
    });
    cleanups.push(socket.cleanup, () => closeServer(fakeDocker));
    await listenUnix(fakeDocker, socket.path);

    const reader = createDockerEventReader({ socketPath: socket.path });
    const values = await reader.readEvents(100, 200);
    expect(values).toHaveLength(2);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual({ method: "GET", url: "/version" });
    expect(requests[1]?.method).toBe("GET");

    const url = new URL(requests[1]?.url ?? "", "http://docker.local");
    expect(url.pathname).toBe("/v1.55/events");
    expect(url.searchParams.get("since")).toBe("100");
    expect(url.searchParams.get("until")).toBe("200");
    expect(JSON.parse(url.searchParams.get("filters") ?? "{}")).toEqual({
      type: ["container"],
      event: [...DOCKER_EVENT_FILTER_ACTIONS],
    });
  });

  it("fails closed on invalid windows, malformed frames, byte overflow and item overflow", async () => {
    const malformedSocket = await tempSocket("malformed.sock");
    const malformed = createServer((incoming, response) => {
      if (incoming.url === "/version") {
        sendVersion(response);
        return;
      }
      response.end("{bad-json}\n");
    });
    cleanups.push(malformedSocket.cleanup, () => closeServer(malformed));
    await listenUnix(malformed, malformedSocket.path);

    const malformedReader = createDockerEventReader({ socketPath: malformedSocket.path });
    await expect(malformedReader.readEvents(200, 100)).rejects.toBeInstanceOf(
      DockerBrokerEventsSourceError,
    );
    await expect(malformedReader.readEvents(0, 3601)).rejects.toBeInstanceOf(
      DockerBrokerEventsSourceError,
    );
    await expect(malformedReader.readEvents(100, 200)).rejects.toBeInstanceOf(
      DockerBrokerEventsSourceError,
    );

    const oversizedSocket = await tempSocket("oversized.sock");
    const oversized = createServer((incoming, response) => {
      if (incoming.url === "/version") {
        sendVersion(response);
        return;
      }
      response.end(`${JSON.stringify({ payload: "x".repeat(128) })}\n`);
    });
    cleanups.push(oversizedSocket.cleanup, () => closeServer(oversized));
    await listenUnix(oversized, oversizedSocket.path);
    await expect(
      createDockerEventReader({ socketPath: oversizedSocket.path, maxResponseBytes: 32 }).readEvents(0, 1),
    ).rejects.toBeInstanceOf(DockerBrokerEventsSourceError);

    const itemsSocket = await tempSocket("items.sock");
    const items = createServer((incoming, response) => {
      if (incoming.url === "/version") {
        sendVersion(response);
        return;
      }
      response.end("{}\n{}\n");
    });
    cleanups.push(itemsSocket.cleanup, () => closeServer(items));
    await listenUnix(items, itemsSocket.path);
    await expect(
      createDockerEventReader({ socketPath: itemsSocket.path, maxItems: 1 }).readEvents(0, 1),
    ).rejects.toBeInstanceOf(DockerBrokerEventsSourceError);
  });

  it("fails closed when the Engine event stream does not complete within the bound", async () => {
    const socket = await tempSocket("timeout.sock");
    const timeout = createServer((incoming, response) => {
      if (incoming.url === "/version") {
        sendVersion(response);
        return;
      }
    });
    cleanups.push(socket.cleanup, () => closeServer(timeout));
    await listenUnix(timeout, socket.path);

    await expect(
      createDockerEventReader({ socketPath: socket.path, requestTimeoutMs: 50 }).readEvents(0, 1),
    ).rejects.toBeInstanceOf(DockerBrokerEventsSourceError);
  });
});
