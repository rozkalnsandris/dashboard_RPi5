import { describe, expect, it, vi } from "vitest";

import type { DockerBrokerEventTransport } from "./docker-broker-client.js";
import { createLiveDockerEventsTransport } from "./docker-events-live.js";
import { buildDockerEventsPath } from "./docker-events.js";
import { DockerSourceUnavailableError } from "./docker-read.js";

describe("live Docker events broker adapter", () => {
  it("converts only a validated Docker event path into numeric broker bounds", async () => {
    const readEvents = vi.fn(async () => [{ Type: "container", Action: "start" }]);
    const broker: DockerBrokerEventTransport = { readEvents };
    const transport = createLiveDockerEventsTransport(broker);

    const values = await transport.read(buildDockerEventsPath(100, 200));
    expect(values).toHaveLength(1);
    expect(readEvents).toHaveBeenCalledTimes(1);
    expect(readEvents).toHaveBeenCalledWith(100, 200, undefined);
  });

  it("never forwards arbitrary Docker paths, filters or invalid windows to the broker", async () => {
    const readEvents = vi.fn(async () => []);
    const broker: DockerBrokerEventTransport = { readEvents };
    const transport = createLiveDockerEventsTransport(broker);

    for (const path of [
      "/v1.40/containers/json?all=true",
      "/v1.40/events?since=100&until=200&filters=%7B%7D",
      "/v1.40/events?since=200&until=100&filters=%7B%22type%22%3A%5B%22container%22%5D%7D",
    ]) {
      await expect(transport.read(path)).rejects.toBeInstanceOf(DockerSourceUnavailableError);
    }
    expect(readEvents).not.toHaveBeenCalled();
  });
});
