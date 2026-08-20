import { buildAgentApp } from "./app.js";
import { isDirectCliInvocation } from "./cli-entry.js";
import { readLiveLogSnapshot } from "./docker-logs-live.js";
import {
  QUICK_COMMANDS_ENV,
  areQuickCommandsEnabled,
} from "./quick-command-activation.js";
import { registerQuickCommandRoutes } from "./quick-command-routes.js";
import {
  DEFAULT_AGENT_SOCKET_PATH,
  prepareSocketPath,
  secureSocketPath,
} from "./socket.js";

interface StartAgentOptions {
  socketPath?: string;
  quickCommandsSetting?: string;
}

export async function startAgent(options: StartAgentOptions = {}) {
  const socketPath =
    options.socketPath ??
    process.env.DASHBOARD_RPI5_AGENT_SOCKET ??
    DEFAULT_AGENT_SOCKET_PATH;
  const quickCommandsSetting =
    options.quickCommandsSetting ?? process.env[QUICK_COMMANDS_ENV];

  await prepareSocketPath(socketPath);

  const { app, operationRegistry } = buildAgentApp({
    logsReader: (sourceId, range, signal) => readLiveLogSnapshot(sourceId, range, signal),
  });
  if (areQuickCommandsEnabled(quickCommandsSetting)) {
    registerQuickCommandRoutes(app);
  }

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

if (isDirectCliInvocation()) {
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
  QUICK_COMMANDS_DISABLED_VALUE,
  QUICK_COMMANDS_ENABLED_VALUE,
  QUICK_COMMANDS_ENV,
  areQuickCommandsEnabled,
} from "./quick-command-activation.js";
export { registerQuickCommandRoutes } from "./quick-command-routes.js";
export {
  AGENT_SOCKET_MODE,
  DEFAULT_AGENT_SOCKET_PATH,
  InvalidSocketPathError,
  SocketPathCollisionError,
  SocketPathInUseError,
  prepareSocketPath,
  secureSocketPath,
} from "./socket.js";
