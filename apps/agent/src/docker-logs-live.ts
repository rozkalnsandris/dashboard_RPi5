import type { LogRange, LogSnapshot, LogSourceId } from "@dashboard-rpi5/contracts/logs";

import { createDockerBrokerTransport } from "./docker-broker-client.js";
import type { DockerBrokerLogSource } from "./docker-broker-protocol.js";
import {
  LogSourceUnavailableError,
  readLogSnapshot,
  type LogReadDependencies,
} from "./logs-read.js";

const DOCKER_SOURCE_MAP: Readonly<
  Partial<Record<LogSourceId, { brokerSource: DockerBrokerLogSource; containerName: string }>>
> = {
  "docker:homeassistant": { brokerSource: "homeassistant", containerName: "homeassistant" },
  "docker:prometheus": { brokerSource: "prometheus", containerName: "prometheus" },
};

const broker = createDockerBrokerTransport();

export async function readLiveLogSnapshot(
  sourceId: LogSourceId,
  range: LogRange,
  signal?: AbortSignal,
): Promise<LogSnapshot> {
  const mapping = DOCKER_SOURCE_MAP[sourceId];
  if (mapping === undefined) {
    return readLogSnapshot(sourceId, range, undefined, signal);
  }

  const dependencies: LogReadDependencies = {
    now: () => new Date(),
    execFile: async () => {
      throw new LogSourceUnavailableError();
    },
    readFileTail: async () => {
      throw new LogSourceUnavailableError();
    },
    readDockerLogs: async (containerName, _sinceSeconds, innerSignal) => {
      if (containerName !== mapping.containerName) throw new LogSourceUnavailableError();
      try {
        return await broker.readLogs(mapping.brokerSource, range, innerSignal);
      } catch {
        throw new LogSourceUnavailableError();
      }
    },
  };

  return readLogSnapshot(sourceId, range, dependencies, signal);
}
