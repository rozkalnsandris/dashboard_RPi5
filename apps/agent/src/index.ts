import { pathToFileURL } from "node:url";

import { buildAgentApp } from "./app.js";
import {
  DEFAULT_AGENT_SOCKET_PATH,
  prepareSocketPath,
  secureSocketPath,
} from "./socket.js";

interface StartAgentOptions {
  socketPath?: string;
}

export async function startAgent(options: StartAgentOptions = {}) {
  const socketPath =
    options.socketPath ??
    process.env.DASHBOARD_RPI5_AGENT_SOCKET ??
    DEFAULT_AGENT_SOCKET_PATH;

  await prepareSocketPath(socketPath);

  const { app, operationRegistry } = buildAgentApp();

  try {
    await app.listen({
      path: socketPath,
      exclusive: true,
      readableAll: false,
      writableAll: false,
    });
    await secureSocketPath(socketPath);
  } catch (error: unknown) {
    await app.close().catch(() => undefined);
    throw error;
  }

  return { app, operationRegistry, socketPath };
}

async function runFromCli() {
  const running = await startAgent();
  let closing = false;

  const close = async () => {
    if (closing) return;
    closing = true;
    await running.app.close();
  };

  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  void runFromCli().catch(() => {
    console.error("dashboard-rpi5-agent failed to start");
    process.exitCode = 1;
  });
}

export { buildAgentApp } from "./app.js";
export {
  OperationRegistry,
  OperationTimeoutError,
  UnknownOperationError,
  normalizeAgentError,
  runWithTimeout,
} from "./operation-registry.js";
export {
  AGENT_SOCKET_MODE,
  DEFAULT_AGENT_SOCKET_PATH,
  InvalidSocketPathError,
  SocketPathCollisionError,
  SocketPathInUseError,
  prepareSocketPath,
  secureSocketPath,
} from "./socket.js";
