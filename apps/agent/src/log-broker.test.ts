import type { LogSnapshot, LogSourceId } from "@dashboard-rpi5/contracts/logs";
import { mkdtemp, rm } from "node:fs/promises";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LOG_BROKER_HEALTH_PATH,
  LOG_BROKER_SOURCE_IDS,
  logBrokerLogsPath,
  parseLogBrokerRoute,
} from "./log-broker-protocol.js";
import {
  buildLogBrokerJournalctlArgs,
  logBrokerSystemdUnitForSource,
  readBrokerLogSnapshot,
  SYSTEMCTL_PATH,
} from "./log-broker-reader.js";
import { createLogBrokerServer, type LogBrokerReader } from "./log-broker-server.js";
import { JOURNALCTL_PATH, LogSourceUnavailableError } from "./logs-read.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function snapshot(sourceId: LogSourceId = "systemd:cloudflared"): LogSnapshot {
  return {
    observedAt: "2026-08-28T10:00:00.000Z",
    source: { sourceId, label: "Cloudflare Tunnel", kind: "SYSTEMD", rangeMode: "TIME" },
    range: "1h",
    rangeApplied: true,
    entries: [
      {
        sequence: 0,
        timestamp: "2026-08-28T09:59:00.000Z",
        level: "INFO",
        stream: "JOURNAL",
        message: "registered tunnel connection",
      },
    ],
    truncated: false,
  };
}

async function tempSocket(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(resolve(tmpdir(), "dashboard-rpi5-log-broker-"));
  return {
    path: resolve(root, "broker.sock"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function listenUnix(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolvePromise();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
}

async function unixRequest(
  socketPath: string,
  path: string,
  options: { method?: string; body?: string } = {},
): Promise<{ status: number; body: unknown; allow?: string }> {
  const body = options.body ?? "";
  return new Promise((resolvePromise, reject) => {
    const req = request(
      {
        socketPath,
        path,
        method: options.method ?? "GET",
        headers: body === "" ? undefined : { "content-length": Buffer.byteLength(body) },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("error", reject);
        response.once("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolvePromise({
            status: response.statusCode ?? 0,
            body: raw === "" ? null : (JSON.parse(raw) as unknown),
            ...(typeof response.headers.allow === "string"
              ? { allow: response.headers.allow }
              : {}),
          });
        });
      },
    );
    req.once("error", reject);
    if (body !== "") req.write(body);
    req.end();
  });
}

describe("bounded log broker protocol", () => {
  it("accepts only the fixed reviewed source IDs and four range presets", () => {
    for (const sourceId of LOG_BROKER_SOURCE_IDS) {
      const path = logBrokerLogsPath(sourceId, "1h");
      expect(parseLogBrokerRoute(path)).toEqual({ kind: "logs", sourceId, range: "1h" });
    }
    expect(parseLogBrokerRoute("/v1/logs/systemd:evil/1h")).toBeNull();
    expect(parseLogBrokerRoute("/v1/logs/file:/etc/shadow/1h")).toBeNull();
    expect(parseLogBrokerRoute("/v1/logs/systemd:cloudflared/7d")).toBeNull();
    expect(parseLogBrokerRoute("/v1/logs/systemd:cloudflared/1h?unit=ssh.service")).toBeNull();
  });

  it("maps every reviewed systemd ID to one exact unit", () => {
    expect(
      [
        "systemd:docker",
        "systemd:ssh",
        "systemd:cron",
        "systemd:dashboard-rpi5-agent",
        "systemd:rpi5-update",
        "systemd:cloudflared",
        "systemd:rpi5-monitor",
        "systemd:rpi5-post-reboot",
        "systemd:rpi5-tmp-headroom",
        "systemd:rpi5-dashboard-evidence",
        "systemd:hermes-tech-web",
      ].map((sourceId) => [sourceId, logBrokerSystemdUnitForSource(sourceId as LogSourceId)]),
    ).toEqual([
      ["systemd:docker", "docker.service"],
      ["systemd:ssh", "ssh.service"],
      ["systemd:cron", "cron.service"],
      ["systemd:dashboard-rpi5-agent", "dashboard-rpi5-agent.service"],
      ["systemd:rpi5-update", "rpi5-update.service"],
      ["systemd:cloudflared", "cloudflared.service"],
      ["systemd:rpi5-monitor", "rpi5-monitor.service"],
      ["systemd:rpi5-post-reboot", "rpi5-post-reboot.service"],
      ["systemd:rpi5-tmp-headroom", "rpi5-tmp-headroom.service"],
      ["systemd:rpi5-dashboard-evidence", "rpi5-dashboard-evidence.service"],
      ["systemd:hermes-tech-web", "hermes-tech-web.service"],
    ]);
    expect(buildLogBrokerJournalctlArgs("systemd:cloudflared", "1h")).toEqual([
      "--no-pager",
      "--output=json",
      "--output-fields=__REALTIME_TIMESTAMP,PRIORITY,MESSAGE,SYSLOG_IDENTIFIER,_SYSTEMD_UNIT,_UID,_TRANSPORT",
      "--unit=cloudflared.service",
      "--since=-1h",
      "--lines=400",
    ]);
  });

  it("checks fixed unit availability before normalizing journal evidence", async () => {
    const calls: Array<{ file: string; args: readonly string[]; shell: boolean }> = [];
    const result = await readBrokerLogSnapshot("systemd:cloudflared", "1h", {
      now: () => new Date("2026-08-28T10:00:00.000Z"),
      execFile: async (file, args, options) => {
        calls.push({ file, args, shell: options.shell });
        if (file === SYSTEMCTL_PATH) return { stdout: "loaded\n" };
        return {
          stdout:
            JSON.stringify({
              __REALTIME_TIMESTAMP: "1787911140000000",
              PRIORITY: "6",
              MESSAGE: "registered tunnel connection",
            }) + "\n",
        };
      },
      readRegistered: async () => {
        throw new Error("unexpected registered-source read");
      },
    });
    expect(result.source.sourceId).toBe("systemd:cloudflared");
    expect(result.entries[0]?.message).toBe("registered tunnel connection");
    expect(calls).toEqual([
      {
        file: SYSTEMCTL_PATH,
        args: ["show", "--property=LoadState", "--value", "cloudflared.service"],
        shell: false,
      },
      {
        file: JOURNALCTL_PATH,
        args: buildLogBrokerJournalctlArgs("systemd:cloudflared", "1h"),
        shell: false,
      },
    ]);
  });

  it("fails closed when an allowlisted systemd unit is not present", async () => {
    const calls: string[] = [];
    await expect(
      readBrokerLogSnapshot("systemd:cloudflared", "1h", {
        now: () => new Date("2026-08-28T10:00:00.000Z"),
        execFile: async (file) => {
          calls.push(file);
          if (file === SYSTEMCTL_PATH) return { stdout: "not-found\n" };
          throw new Error("journal read must not run for a missing unit");
        },
        readRegistered: async () => {
          throw new Error("unexpected registered-source read");
        },
      }),
    ).rejects.toBeInstanceOf(LogSourceUnavailableError);
    expect(calls).toEqual([SYSTEMCTL_PATH]);
  });
});

describe("bounded log broker Unix HTTP boundary", () => {
  it("exposes GET-only fixed read capabilities and no mutation/generic proxy route", async () => {
    const socket = await tempSocket();
    const reader: LogBrokerReader = { read: async () => snapshot() };
    const server = createLogBrokerServer({ reader });
    cleanups.push(socket.cleanup, () => closeServer(server));
    await listenUnix(server, socket.path);

    expect(await unixRequest(socket.path, LOG_BROKER_HEALTH_PATH)).toMatchObject({
      status: 200,
      body: { status: "ok", service: "dashboard-rpi5-log-broker" },
    });
    expect(
      (await unixRequest(socket.path, logBrokerLogsPath("systemd:cloudflared", "1h"))).status,
    ).toBe(200);
    expect(
      await unixRequest(socket.path, logBrokerLogsPath("systemd:cloudflared", "1h"), {
        method: "POST",
      }),
    ).toMatchObject({
      status: 405,
      body: { error: "METHOD_NOT_ALLOWED" },
      allow: "GET",
    });
    expect((await unixRequest(socket.path, "/v1/logs/systemd:cloudflared/1h/restart")).status).toBe(404);
    expect((await unixRequest(socket.path, "/v1/logs/systemd:evil/1h")).status).toBe(404);
    expect(
      await unixRequest(socket.path, logBrokerLogsPath("systemd:cloudflared", "1h"), {
        body: "{}",
      }),
    ).toMatchObject({
      status: 400,
      body: { error: "INVALID_REQUEST" },
    });
  });

  it("enforces concurrency, response and deadline bounds", async () => {
    const socket = await tempSocket();
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    const began = new Promise<void>((resolvePromise) => {
      started = resolvePromise;
    });
    const reader: LogBrokerReader = {
      read: async () => {
        started();
        await held;
        return snapshot();
      },
    };
    const server = createLogBrokerServer({ reader, maxConcurrentRequests: 1 });
    cleanups.push(socket.cleanup, () => closeServer(server));
    await listenUnix(server, socket.path);
    const first = unixRequest(socket.path, logBrokerLogsPath("systemd:cloudflared", "1h"));
    await began;
    expect(await unixRequest(socket.path, logBrokerLogsPath("systemd:ssh", "1h"))).toMatchObject({
      status: 503,
      body: { error: "SOURCE_UNAVAILABLE" },
    });
    release();
    expect((await first).status).toBe(200);

    await closeServer(server);
    const boundedServer = createLogBrokerServer({
      reader: {
        read: async () => ({
          ...snapshot(),
          entries: [{ ...snapshot().entries[0]!, message: "x".repeat(8_000) }],
        }),
      },
      maxResponseBytes: 256,
    });
    cleanups.push(() => closeServer(boundedServer));
    await listenUnix(boundedServer, socket.path);
    expect(
      await unixRequest(socket.path, logBrokerLogsPath("systemd:cloudflared", "1h")),
    ).toMatchObject({
      status: 503,
      body: { error: "SOURCE_UNAVAILABLE" },
    });
    await closeServer(boundedServer);

    const timeoutServer = createLogBrokerServer({
      reader: {
        read: async (_sourceId, _range, signal) =>
          new Promise<LogSnapshot>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
      },
      requestTimeoutMs: 20,
    });
    cleanups.push(() => closeServer(timeoutServer));
    await listenUnix(timeoutServer, socket.path);
    expect(
      await unixRequest(socket.path, logBrokerLogsPath("systemd:cloudflared", "1h")),
    ).toMatchObject({
      status: 503,
      body: { error: "SOURCE_UNAVAILABLE" },
    });
  });
});
