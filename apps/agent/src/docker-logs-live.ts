import type { LogRange, LogSnapshot, LogSourceId } from "@dashboard-rpi5/contracts/logs";

import { createDockerBrokerTransport } from "./docker-broker-client.js";
import type { DockerBrokerLogSource } from "./docker-broker-protocol.js";
import { createLogBrokerTransport } from "./log-broker-client.js";
import { LogSourceUnavailableError, readLogSnapshot, type LogReadDependencies } from "./logs-read.js";
import { isPrivilegedLogSourceId, privilegedLogSourcesEnabled } from "./privileged-log-sources.js";

const DOCKER_SOURCE_MAP: Readonly<
  Partial<Record<LogSourceId, { brokerSource: DockerBrokerLogSource; containerName: string }>>
> = {
  "docker:homeassistant": { brokerSource: "homeassistant", containerName: "homeassistant" },
  "docker:prometheus": { brokerSource: "prometheus", containerName: "prometheus" },
};

const dockerBroker = createDockerBrokerTransport();
const privilegedLogBroker = createLogBrokerTransport();

export async function readLiveLogSnapshot(
  sourceId: LogSourceId,
  range: LogRange,
  signal?: AbortSignal,
): Promise<LogSnapshot> {
  const mapping = DOCKER_SOURCE_MAP[sourceId];
  if (mapping !== undefined) {
    const dependencies: LogReadDependencies = {
      now: () => new Date(),
      execFile: async () => { throw new LogSourceUnavailableError(); },
      readFileTail: async () => { throw new LogSourceUnavailableError(); },
      readDockerLogs: async (containerName, _sinceSeconds, innerSignal) => {
        if (containerName !== mapping.containerName) throw new LogSourceUnavailableError();
        try { return await dockerBroker.readLogs(mapping.brokerSource, range, innerSignal); }
        catch { throw new LogSourceUnavailableError(); }
      },
    };
    return readLogSnapshot(sourceId, range, dependencies, signal);
  }

  if (!privilegedLogSourcesEnabled() || !isPrivilegedLogSourceId(sourceId)) throw new LogSourceUnavailableError();
  try { return await privilegedLogBroker.readLogs(sourceId, range, signal); }
  catch { throw new LogSourceUnavailableError(); }
}
