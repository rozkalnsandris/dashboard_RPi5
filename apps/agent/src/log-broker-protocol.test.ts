import { describe, expect, it } from "vitest";

import { logBrokerLogsPath, parseLogBrokerRoute } from "./log-broker-protocol.js";

describe("privileged log broker protocol", () => {
  it("round-trips only fixed registered source IDs and ranges", () => {
    const path = logBrokerLogsPath("systemd:rpi5-monitor", "6h");
    expect(path).toBe("/v1/logs/systemd%3Arpi5-monitor/6h");
    expect(parseLogBrokerRoute(path)).toEqual({ kind: "logs", sourceId: "systemd:rpi5-monitor", range: "6h" });
  });

  it("rejects arbitrary units, paths, query widening and Docker sources", () => {
    expect(parseLogBrokerRoute("/v1/logs/systemd%3Aunregistered/1h")).toBeNull();
    expect(parseLogBrokerRoute("/v1/logs/file%3A%2Ftmp%2Funregistered.log/1h")).toBeNull();
    expect(parseLogBrokerRoute("/v1/logs/docker%3Ahomeassistant/1h")).toBeNull();
    expect(parseLogBrokerRoute("/v1/logs/systemd%3Assh/1h?unit=unregistered")).toBeNull();
  });
});
