import { describe, expect, it, vi } from "vitest";

const brokerMocks = vi.hoisted(() => ({
  readDockerLogs: vi.fn(),
  readLogSnapshot: vi.fn(),
}));

vi.mock("./docker-broker-client.js", () => ({
  createDockerBrokerTransport: () => ({
    readLogs: brokerMocks.readDockerLogs,
  }),
}));

vi.mock("./log-broker-client.js", () => ({
  createLogBrokerTransport: () => ({
    readSnapshot: brokerMocks.readLogSnapshot,
  }),
}));

import { readLiveLogSnapshot } from "./docker-logs-live.js";
import { LogSourceUnavailableError } from "./logs-read.js";

describe("production live log source boundary", () => {
  it("fails closed for registered broker sources when the bounded log broker is unavailable", async () => {
    brokerMocks.readLogSnapshot.mockRejectedValue(new Error("test log broker unavailable"));

    await expect(readLiveLogSnapshot("systemd:rpi5-update", "1h")).rejects.toBeInstanceOf(
      LogSourceUnavailableError,
    );
    await expect(readLiveLogSnapshot("file:rpi5-backup", "24h")).rejects.toBeInstanceOf(
      LogSourceUnavailableError,
    );

    expect(brokerMocks.readLogSnapshot).toHaveBeenCalledTimes(2);
    expect(brokerMocks.readDockerLogs).not.toHaveBeenCalled();
  });
});
