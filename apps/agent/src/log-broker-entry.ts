import { isDirectCliInvocation } from "./cli-entry.js";
import {
  DEFAULT_LOG_BROKER_SOCKET_PATH,
  LOG_BROKER_SOCKET_ENV,
} from "./log-broker-protocol.js";
import { createLogBrokerServer, type LogBrokerReader } from "./log-broker-server.js";
import { prepareSocketPath, secureSocketPath } from "./socket.js";

interface StartLogBrokerOptions {
  socketPath?: string;
  reader?: LogBrokerReader;
}

export async function startLogBroker(options: StartLogBrokerOptions = {}) {
  const socketPath = options.socketPath ?? process.env[LOG_BROKER_SOCKET_ENV] ?? DEFAULT_LOG_BROKER_SOCKET_PATH;
  await prepareSocketPath(socketPath);
  const server = createLogBrokerServer({ ...(options.reader === undefined ? {} : { reader: options.reader }) });

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({ path: socketPath, exclusive: true, readableAll: false, writableAll: false });
    });
    await secureSocketPath(socketPath);
  } catch (error: unknown) {
    await new Promise<void>((resolve) => server.close(() => resolve())).catch(() => undefined);
    throw error;
  }

  return { server, socketPath };
}

async function runFromCli() {
  const running = await startLogBroker();
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    running.server.close(() => undefined);
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

if (isDirectCliInvocation()) {
  void runFromCli().catch(() => {
    console.error("dashboard-rpi5-log-broker failed to start");
    process.exitCode = 1;
  });
}
