import { describe, expect, it } from "vitest";

import { readLiveLogSnapshot } from "./docker-logs-live.js";
import { LogSourceUnavailableError } from "./logs-read.js";

describe("production live log source boundary", () => {
  it("keeps privileged registered source IDs fail-closed while the feature gate is disabled", async () => {
    await expect(readLiveLogSnapshot("systemd:rpi5-update", "1h")).rejects.toBeInstanceOf(LogSourceUnavailableError);
    await expect(readLiveLogSnapshot("systemd:cloudflared", "1h")).rejects.toBeInstanceOf(LogSourceUnavailableError);
    await expect(readLiveLogSnapshot("file:rpi5-backup", "24h")).rejects.toBeInstanceOf(LogSourceUnavailableError);
  });
});
