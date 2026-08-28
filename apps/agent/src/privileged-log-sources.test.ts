import { describe, expect, it } from "vitest";

import {
  getPrivilegedLogSourceRegistration,
  isPrivilegedLogSourceId,
  PRIVILEGED_LOG_SOURCE_IDS,
} from "./privileged-log-sources.js";

describe("privileged log source allowlist", () => {
  it("contains only the reviewed RPi5 system, journal and backup targets", () => {
    expect(PRIVILEGED_LOG_SOURCE_IDS).toEqual([
      "systemd:docker", "systemd:ssh", "systemd:cron", "systemd:dashboard-rpi5-agent",
      "systemd:rpi5-update", "systemd:cloudflared", "systemd:rpi5-monitor",
      "systemd:rpi5-post-reboot", "systemd:rpi5-tmp-headroom", "systemd:rpi5-dashboard-evidence",
      "systemd:hermes-tech-web", "journal:rpi5-deploy", "file:rpi5-backup",
    ]);
    expect(getPrivilegedLogSourceRegistration("systemd:cloudflared")).toMatchObject({ kind: "SYSTEMD", unitId: "cloudflared.service" });
    expect(getPrivilegedLogSourceRegistration("systemd:hermes-tech-web")).toMatchObject({ kind: "SYSTEMD", unitId: "hermes-tech-web.service" });
    expect(getPrivilegedLogSourceRegistration("file:rpi5-backup")).toMatchObject({ kind: "FILE", path: "/var/log/rpi5-backup.log" });
  });

  it("does not accept Docker sources or caller-invented IDs", () => {
    expect(isPrivilegedLogSourceId("docker:homeassistant")).toBe(false);
    expect(isPrivilegedLogSourceId("systemd:not-registered" as never)).toBe(false);
  });
});
