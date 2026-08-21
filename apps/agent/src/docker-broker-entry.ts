import {
  createDockerBrokerServer,
  createDockerEngineReader,
  type DockerEngineReader,
} from "./docker-broker-server.js";
import {
  DEFAULT_DOCKER_BROKER_SOCKET_PATH,
  DOCKER_BROKER_SOCKET_ENV,
} from "./docker-broker-protocol.js";
import { isDirectCliInvocation } from "./cli-entry.js";
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
      server.listen({
        path: socketPath,
        exclusive: true,
        readableAll: false,
        writableAll: false,
      });
    });
    await secureSocketPath(socketPath);
  } catch (error: unknown) {
    await new Promise<void>((resolve) => server.close(() => resolve())).catch(() => undefined);
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

if (isDirectCliInvocation()) {
  void runFromCli().catch(() => {
    console.error("dashboard-rpi5-docker-broker failed to start");
    process.exitCode = 1;
  });
}
