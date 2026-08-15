import { once } from "node:events";
import {
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  InvalidSocketPathError,
  SocketPathCollisionError,
  SocketPathInUseError,
  prepareSocketPath,
} from "./socket.js";

const tempRoots: string[] = [];

async function tempSocketPath() {
  const root = await mkdtemp(join(tmpdir(), "dashboard-rpi5-agent-"));
  tempRoots.push(root);
  return join(root, "agent.sock");
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("prepareSocketPath", () => {
  it("rejects relative paths", async () => {
    await expect(prepareSocketPath("agent.sock")).rejects.toBeInstanceOf(
      InvalidSocketPathError,
    );
  });

  it("never removes a non-socket path collision", async () => {
    const socketPath = await tempSocketPath();
    await writeFile(socketPath, "do-not-delete", "utf8");

    await expect(prepareSocketPath(socketPath)).rejects.toBeInstanceOf(
      SocketPathCollisionError,
    );
    await expect(readFile(socketPath, "utf8")).resolves.toBe("do-not-delete");
  });

  it("never unlinks an active Unix socket", async () => {
    const socketPath = await tempSocketPath();
    const server = createServer();

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    try {
      await expect(prepareSocketPath(socketPath)).rejects.toBeInstanceOf(
        SocketPathInUseError,
      );
      expect((await lstat(socketPath)).isSocket()).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    }
  });

  it.runIf(process.platform !== "win32")(
    "removes a crash-left stale Unix socket only after probing it",
    async () => {
      const socketPath = await tempSocketPath();
      const script = [
        "const net = require('node:net');",
        `const server = net.createServer(); server.listen(${JSON.stringify(socketPath)}, () => process.stdout.write('ready\\n'));`,
        "setInterval(() => {}, 1000);",
      ].join(" ");

      const child = spawn(process.execPath, ["-e", script], {
        stdio: ["ignore", "pipe", "ignore"],
      });

      if (child.stdout === null) throw new Error("child stdout unavailable");
      await once(child.stdout, "data");
      child.kill("SIGKILL");
      await once(child, "exit");

      expect((await lstat(socketPath)).isSocket()).toBe(true);
      await prepareSocketPath(socketPath);
      await expect(lstat(socketPath)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
});
