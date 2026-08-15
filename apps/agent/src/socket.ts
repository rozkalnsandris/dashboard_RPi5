import { chmod, lstat, unlink } from "node:fs/promises";
import { createConnection } from "node:net";
import { isAbsolute } from "node:path";

export const DEFAULT_AGENT_SOCKET_PATH = "/run/dashboard-rpi5/agent.sock";
export const AGENT_SOCKET_MODE = 0o660;
const SOCKET_PROBE_TIMEOUT_MS = 250;

export class InvalidSocketPathError extends Error {
  constructor() {
    super("Invalid agent socket path");
    this.name = "InvalidSocketPathError";
  }
}

export class SocketPathCollisionError extends Error {
  constructor() {
    super("Configured agent socket path is not safe to replace");
    this.name = "SocketPathCollisionError";
  }
}

export class SocketPathInUseError extends Error {
  constructor() {
    super("Configured agent socket path is already in use");
    this.name = "SocketPathInUseError";
  }
}

function validateSocketPath(socketPath: string) {
  if (
    socketPath.length === 0 ||
    socketPath.includes("\0") ||
    !isAbsolute(socketPath)
  ) {
    throw new InvalidSocketPathError();
  }
}

async function probeSocket(socketPath: string): Promise<"active" | "stale"> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let settled = false;

    const finish = (
      result?: "active" | "stale",
      error?: Error,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();

      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve(result ?? "stale");
    };

    const timer = setTimeout(
      () => finish(undefined, new SocketPathCollisionError()),
      SOCKET_PROBE_TIMEOUT_MS,
    );

    socket.once("connect", () => finish("active"));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED" || error.code === "ENOENT") {
        finish("stale");
        return;
      }

      finish(undefined, new SocketPathCollisionError());
    });
  });
}

export async function prepareSocketPath(socketPath: string) {
  validateSocketPath(socketPath);

  let initialStat;
  try {
    initialStat = await lstat(socketPath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  if (!initialStat.isSocket()) {
    throw new SocketPathCollisionError();
  }

  const state = await probeSocket(socketPath);
  if (state === "active") {
    throw new SocketPathInUseError();
  }

  let currentStat;
  try {
    currentStat = await lstat(socketPath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  if (
    !currentStat.isSocket() ||
    currentStat.dev !== initialStat.dev ||
    currentStat.ino !== initialStat.ino
  ) {
    throw new SocketPathCollisionError();
  }

  await unlink(socketPath);
}

export async function secureSocketPath(socketPath: string) {
  validateSocketPath(socketPath);
  await chmod(socketPath, AGENT_SOCKET_MODE);
}
