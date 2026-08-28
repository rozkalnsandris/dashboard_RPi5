import type { LogSnapshot } from "@dashboard-rpi5/contracts/logs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { logBrokerLogsPath } from "./log-broker-protocol.js";
import { createLogBrokerServer, type PrivilegedLogReader } from "./log-broker-server.js";

const servers: ReturnType<typeof createLogBrokerServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function snapshot(): LogSnapshot {
  return {
    observedAt: "2026-08-28T08:00:00.000Z",
    source: { sourceId: "systemd:rpi5-monitor", label: "RPi5 monitor", kind: "SYSTEMD", rangeMode: "TIME" },
    range: "1h", rangeApplied: true, entries: [], truncated: false,
  };
}

async function listen(reader: PrivilegedLogReader, maxConcurrentRequests = 4) {
  const server = createLogBrokerServer({ reader, maxConcurrentRequests });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

async function call(port: number, path: string, method = "GET") {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.once("error", reject);
    req.end();
  });
}

describe("privileged log broker server", () => {
  it("dispatches only the fixed parsed source and exposes no mutation method", async () => {
    const reader = vi.fn<PrivilegedLogReader>(async () => snapshot());
    const port = await listen(reader);
    const path = logBrokerLogsPath("systemd:rpi5-monitor", "1h");
    expect((await call(port, path)).status).toBe(200);
    expect(reader).toHaveBeenCalledWith("systemd:rpi5-monitor", "1h", expect.any(AbortSignal));
    expect((await call(port, path, "POST")).status).toBe(405);
    expect((await call(port, "/v1/logs/file%3A%2Ftmp%2Funregistered.log/1h")).status).toBe(404);
  });

  it("fails closed when the bounded concurrency limit is occupied", async () => {
    let release = () => {};
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const reader: PrivilegedLogReader = async () => { await wait; return snapshot(); };
    const port = await listen(reader, 1);
    const path = logBrokerLogsPath("systemd:rpi5-monitor", "1h");
    const first = call(port, path);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await call(port, path)).status).toBe(503);
    release();
    expect((await first).status).toBe(200);
  });
});
