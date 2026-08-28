import { describe, expect, it } from "vitest";

import { listProductionLogSources, PRODUCTION_LOG_SOURCE_IDS } from "./production-log-sources.js";

describe("production log source advertisement", () => {
  it("advertises exactly the reviewed Docker and bounded log-broker capabilities", () => {
    expect(PRODUCTION_LOG_SOURCE_IDS).toEqual([
      "docker:homeassistant",
      "docker:prometheus",
      "systemd:docker",
      "systemd:ssh",
      "systemd:cron",
      "systemd:dashboard-rpi5-agent",
      "systemd:rpi5-update",
      "systemd:cloudflared",
      "systemd:rpi5-monitor",
      "systemd:rpi5-post-reboot",
      "systemd:rpi5-tmp-headroom",
      "systemd:rpi5-dashboard-evidence",
      "systemd:hermes-tech-web",
      "journal:rpi5-deploy",
      "file:rpi5-backup",
    ]);

    const snapshot = listProductionLogSources(new Date("2026-08-28T10:00:00.000Z"));
    expect(snapshot.sources.map((source) => source.sourceId)).toEqual(PRODUCTION_LOG_SOURCE_IDS);
    expect(new Set(snapshot.sources.map((source) => source.kind))).toEqual(
      new Set(["DOCKER", "SYSTEMD", "JOURNAL", "FILE"]),
    );
    expect(snapshot.observedAt).toBe("2026-08-28T10:00:00.000Z");
  });
});
