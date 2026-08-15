import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type RequestListener, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AGENT_BACKUP_EVIDENCE_PATH,
  AgentBackupEvidenceSourceError,
  createAgentBackupEvidenceReader,
} from "./agent-backup-evidence-client.js";

const servers: Server[] = [];
const directories: string[] = [];

async function listen(handler: RequestListener) {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-backup-client-"));
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
  observedAt: "2026-08-15T18:00:00.000Z",
  schema: "dashboard-rpi5.backup-evidence.v1",
  runs: [
    {
      runId: "20260815T020000+0200",
      startedAt: "2026-08-15T02:00:00+02:00",
      completedAt: "2026-08-15T02:02:00+02:00",
      result: "SUCCESS",
      durationSeconds: 120,
      sizeBytes: 123_456,
      exitCode: 0,
    },
  ],
};

describe("Phase 5C-B backup evidence Unix-socket client", () => {
  it("uses only the fixed agent route and validates structured evidence", async () => {
    const paths: string[] = [];
    const socketPath = await listen((request, response) => {
      paths.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });

    await expect(createAgentBackupEvidenceReader({ socketPath })()).resolves.toEqual(payload);
    expect(paths).toEqual([AGENT_BACKUP_EVIDENCE_PATH]);
  });

  it("fails closed on non-200, schema drift and oversized responses", async () => {
    const non200Socket = await listen((_request, response) => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end('{"private":"detail"}');
    });
    await expect(createAgentBackupEvidenceReader({ socketPath: non200Socket })()).rejects.toBeInstanceOf(
      AgentBackupEvidenceSourceError,
    );

    const driftSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...payload, path: "/var/log/rpi5-backup.log" }));
    });
    await expect(createAgentBackupEvidenceReader({ socketPath: driftSocket })()).rejects.toBeInstanceOf(
      AgentBackupEvidenceSourceError,
    );

    const oversizedSocket = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ...payload, padding: "x".repeat(2_000) }));
    });
    await expect(
      createAgentBackupEvidenceReader({ socketPath: oversizedSocket, maxBytes: 1_024 })(),
    ).rejects.toBeInstanceOf(AgentBackupEvidenceSourceError);
  });

  it("rejects ambiguous timestamp or result correlation from the agent", async () => {
    for (const run of [
      { ...payload.runs[0], completedAt: "2026-08-15T02:02:00" },
      { ...payload.runs[0], result: "SUCCESS", exitCode: 2 },
      { ...payload.runs[0], durationSeconds: 42 },
    ]) {
      const socketPath = await listen((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ...payload, runs: [run] }));
      });
      await expect(createAgentBackupEvidenceReader({ socketPath })()).rejects.toBeInstanceOf(
        AgentBackupEvidenceSourceError,
      );
    }
  });

  it("bounds stalled requests and rejects unsafe socket configuration", async () => {
    const socketPath = await listen(() => {
      // Intentionally left open until the wall-clock deadline destroys the request.
    });
    await expect(
      createAgentBackupEvidenceReader({ socketPath, timeoutMs: 20 })(),
    ).rejects.toBeInstanceOf(AgentBackupEvidenceSourceError);

    expect(() => createAgentBackupEvidenceReader({ socketPath: "relative.sock" })).toThrow(TypeError);
    expect(() => createAgentBackupEvidenceReader({ socketPath: `/tmp/${"x".repeat(120)}` })).toThrow(TypeError);
  });
});
