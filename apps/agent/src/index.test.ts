import { mkdtemp, rm, stat } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AGENT_SOCKET_MODE } from "./socket.js";
import { startAgent } from "./index.js";

const tempRoots: string[] = [];

async function tempSocketPath() {
  const root = await mkdtemp(join(tmpdir(), "dashboard-rpi5-agent-http-"));
  tempRoots.push(root);
  return join(root, "agent.sock");
}

function getJson(socketPath: string, path: string) {
  return new Promise<{ statusCode: number; body: unknown }>((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path,
        method: "GET",
        headers: { accept: "application/json" },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          try {
            resolve({
              statusCode: response.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            });
          } catch (error: unknown) {
            reject(error);
          }
        });
      },
    );

    req.once("error", reject);
    req.end();
  });
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("startAgent", () => {
  it.runIf(process.platform !== "win32")(
    "serves health only over the configured Unix socket and narrows its mode",
    async () => {
      const socketPath = await tempSocketPath();
      const running = await startAgent({ socketPath });

      try {
        const socketStat = await stat(socketPath);
        expect(socketStat.mode & 0o777).toBe(AGENT_SOCKET_MODE);

        const response = await getJson(socketPath, "/v1/health");
        expect(response.statusCode).toBe(200);
        expect(response.body).toMatchObject({
          status: "ok",
          service: "dashboard-rpi5-agent",
          mode: "SOURCE_ONLY",
          protocolVersion: 1,
          capabilities: ["protocol.health"],
        });
      } finally {
        await running.app.close();
      }
    },
  );
});
