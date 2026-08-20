import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const dockerReadSource = readFileSync(new URL("./docker-read.ts", import.meta.url), "utf8");
const dockerEventsSource = readFileSync(new URL("./docker-events.ts", import.meta.url), "utf8");
const dockerEventsLiveSource = readFileSync(new URL("./docker-events-live.ts", import.meta.url), "utf8");
const brokerEventsSource = readFileSync(new URL("./docker-broker-events.ts", import.meta.url), "utf8");
const logsReadSource = readFileSync(new URL("./logs-read.ts", import.meta.url), "utf8");
const brokerServerSource = readFileSync(new URL("./docker-broker-server.ts", import.meta.url), "utf8");

describe("Docker Engine authority boundary", () => {
  it("keeps the main current-state reader away from the Docker Engine socket", () => {
    expect(dockerReadSource).not.toContain("/var/run/docker.sock");
    expect(dockerReadSource).not.toContain('from "node:http"');
    expect(dockerReadSource).not.toContain("socketPath: DOCKER_SOCKET_PATH");
    expect(dockerReadSource).toContain("createDockerBrokerTransport");
  });

  it("keeps event normalization fail-closed by default and live events behind the broker", async () => {
    expect(dockerEventsSource).not.toContain("/var/run/docker.sock");
    expect(dockerEventsSource).not.toContain('from "node:http"');
    expect(dockerEventsSource).toContain("createUnavailableDockerEventsTransport");
    expect(dockerEventsLiveSource).not.toContain("/var/run/docker.sock");
    expect(dockerEventsLiveSource).not.toContain('from "node:http"');
    expect(dockerEventsLiveSource).toContain("createDockerBrokerTransport");
    expect(dockerEventsLiveSource).toContain("readEvents(since, until");

    const { DockerSourceUnavailableError } = await import("./docker-read.js");
    const { readRecentDockerEvents } = await import("./docker-events.js");
    await expect(readRecentDockerEvents()).rejects.toBeInstanceOf(DockerSourceUnavailableError);
  });

  it("keeps Docker log defaults fail-closed without an Engine socket transport", async () => {
    expect(logsReadSource).not.toContain("/var/run/docker.sock");
    expect(logsReadSource).not.toContain('from "node:http"');
    expect(logsReadSource).toContain("Docker log retrieval is outside #119's reviewed broker allowlist");

    const { LogSourceUnavailableError, readLogSnapshot } = await import("./logs-read.js");
    await expect(readLogSnapshot("docker:homeassistant", "15m")).rejects.toBeInstanceOf(
      LogSourceUnavailableError,
    );
  });

  it("confines Docker Engine event HTTP authority to the dedicated broker side", () => {
    expect(brokerServerSource).toContain("DEFAULT_DOCKER_ENGINE_SOCKET_PATH");
    expect(brokerServerSource).toContain('from "node:http"');
    expect(brokerEventsSource).toContain("DEFAULT_DOCKER_ENGINE_SOCKET_PATH");
    expect(brokerEventsSource).toContain('from "node:http"');
    expect(brokerEventsSource).toContain('method: "GET"');
    expect(brokerEventsSource).toContain("buildDockerEventsPath(since, until)");
    for (const source of [brokerServerSource, brokerEventsSource]) {
      expect(source).not.toContain("exec(");
      expect(source).not.toContain("spawn(");
      expect(source).not.toContain("execFile(");
    }
  });
});
