import { createDockerBrokerTransport, type DockerBrokerEventTransport } from "./docker-broker-client.js";
import {
  isAllowedDockerEventsPath,
  readRecentDockerEvents,
  type DockerEventsTransport,
} from "./docker-events.js";
import { DockerSourceUnavailableError } from "./docker-read.js";

export function createLiveDockerEventsTransport(
  broker: DockerBrokerEventTransport = createDockerBrokerTransport(),
): DockerEventsTransport {
  return {
    async read(path, signal) {
      if (!isAllowedDockerEventsPath(path)) throw new DockerSourceUnavailableError();
      try {
        const url = new URL(path, "http://docker.local");
        const since = Number(url.searchParams.get("since"));
        const until = Number(url.searchParams.get("until"));
        return await broker.readEvents(since, until, signal);
      } catch {
        throw new DockerSourceUnavailableError();
      }
    },
  };
}

const liveTransport = createLiveDockerEventsTransport();

export function readLiveRecentDockerEvents(signal?: AbortSignal) {
  return readRecentDockerEvents(liveTransport, signal);
}
