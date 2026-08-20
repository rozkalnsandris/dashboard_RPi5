import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDockerBrokerServer,
  createDockerEngineReader,
  type DockerEngineReader,
} from "./docker-broker-server.js";
import {
  DEFAULT_DOCKER_BROKER_SOCKET_PATH,
  DOCKER_BROKER_SOCKET_ENV,
} from "./docker-broker-protocol.js";
import { prepareSocketPath, secureSocketPath } from "./socket.js";

interface StartDockerBrokerOptions {
  socketPath?: string;
  engineReader?: DockerEngineReader;
}

export async function startDockerBroker(options: StartDockerBrokerOptions = {}) {
  const socketPath =
    options.socketPath ??
    process.env[DOCKER_BROKER_SOCKET_ENV] ??
    DEFAULT_DOCKER_BROKER_SOCKET_PATH;

  await prepareSocketPath(socketPath);
  const server = createDockerBrokerServer({
    engineReader: options.engineReader ?? createDockerEngineReader(),
  });

  try {
    await new Promise<void>((resolveListening, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolveListening();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({
        path: socketPath,
        exclusive: true,
        readableAll: false,
        writableAll: false,
      });
    });
    await secureSocketPath(socketPath);
  } catch (error: unknown) {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose())).catch(() => undefined);
    throw error;
  }

  return { server, socketPath };
}

async function runFromCli() {
  const running = await startDockerBroker();
  let closing = false;

  const close = () => {
    if (closing) return;
    closing = true;
    running.server.close(() => undefined);
  };

  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  void runFromCli().catch(() => {
    console.error("dashboard-rpi5-docker-broker failed to start");
    process.exitCode = 1;
  });
}
