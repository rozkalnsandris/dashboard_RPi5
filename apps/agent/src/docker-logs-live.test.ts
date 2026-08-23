import { describe, expect, it } from "vitest";

import { readLiveLogSnapshot } from "./docker-logs-live.js";
import { LogSourceUnavailableError } from "./logs-read.js";

describe("production live log source boundary", () => {
  it("rejects dormant registered source IDs before any backend read", async () => {
    await expect(readLiveLogSnapshot("systemd:rpi5-update", "1h")).rejects.toBeInstanceOf(
      LogSourceUnavailableError,
    );
    await expect(readLiveLogSnapshot("file:rpi5-backup", "24h")).rejects.toBeInstanceOf(
      LogSourceUnavailableError,
    );
  });
});
