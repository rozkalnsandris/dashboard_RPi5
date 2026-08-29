import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const agentUnit = readFileSync(
  new URL("../../../ops/systemd/dashboard-rpi5-agent.service", import.meta.url),
  "utf8",
);

describe("main agent systemd hardening boundary", () => {
  it("adds compatible sandbox controls without widening authority", () => {
    for (const directive of [
      "NoNewPrivileges=yes",
      "CapabilityBoundingSet=",
      "AmbientCapabilities=",
      "PrivateTmp=yes",
      "PrivateDevices=yes",
      "PrivateNetwork=yes",
      "ProtectSystem=strict",
      "ProtectHome=yes",
      "ProtectKernelTunables=yes",
      "ProtectKernelModules=yes",
      "ProtectKernelLogs=yes",
      "ProtectControlGroups=yes",
      "ProtectClock=yes",
      "ProtectHostname=yes",
      "LockPersonality=yes",
      "RestrictNamespaces=yes",
      "RestrictSUIDSGID=yes",
      "RestrictRealtime=yes",
      "RestrictAddressFamilies=AF_UNIX",
      "SystemCallArchitectures=native",
    ]) {
      expect(agentUnit).toContain(directive);
    }

    expect(agentUnit).not.toContain("User=root");
    expect(agentUnit).not.toContain("SupplementaryGroups=docker");
    expect(agentUnit).not.toContain("SupplementaryGroups=video");
    expect(agentUnit).not.toContain("SupplementaryGroups=adm");
    expect(agentUnit).not.toContain("SupplementaryGroups=systemd-journal");
    expect(agentUnit).not.toContain("SupplementaryGroups=sudo");
  });

  it("preserves host-wide proc evidence required by the read-only host summary", () => {
    expect(agentUnit).not.toContain("ProcSubset=pid");
  });
});
