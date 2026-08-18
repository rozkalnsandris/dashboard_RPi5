import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const dockerReadSource = readFileSync(new URL("./docker-read.ts", import.meta.url), "utf8");
const dockerEventsSource = readFileSync(new URL("./docker-events.ts", import.meta.url), "utf8");
const logsReadSource = readFileSync(new URL("./logs-read.ts", import.meta.url), "utf8");
const brokerServerSource = readFileSync(new URL("./docker-broker-server.ts", import.meta.url), "utf8");

describe("Docker Engine authority boundary", () => {
  it("keeps the main current-state reader away from the Docker Engine socket", () => {
    expect(dockerReadSource).not.toContain("/var/run/docker.sock");
    expect(dockerReadSource).not.toContain('from "node:http"');
    expect(dockerReadSource).not.toContain("socketPath: DOCKER_SOCKET_PATH");
    expect(dockerReadSource).toContain("createDockerBrokerTransport");
  });

  it("keeps recent Docker events fail-closed instead of retaining direct socket authority", async () => {
    expect(dockerEventsSource).not.toContain("/var/run/docker.sock");
    expect(dockerEventsSource).not.toContain('from "node:http"');
    expect(dockerEventsSource).toContain("createUnavailableDockerEventsTransport");

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

  it("confines Docker Engine socket configuration to the dedicated broker reader", () => {
    expect(brokerServerSource).toContain("DEFAULT_DOCKER_ENGINE_SOCKET_PATH");
    expect(brokerServerSource).toContain('from "node:http"');
    expect(brokerServerSource).not.toContain("exec(");
    expect(brokerServerSource).not.toContain("spawn(");
    expect(brokerServerSource).not.toContain("execFile(");
  });
});
