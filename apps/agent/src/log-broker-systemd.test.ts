import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const brokerUnit = readFileSync(
  new URL("../../../ops/systemd/dashboard-rpi5-log-broker.service", import.meta.url),
  "utf8",
);
const agentUnit = readFileSync(
  new URL("../../../ops/systemd/dashboard-rpi5-agent.service", import.meta.url),
  "utf8",
);

function supplementaryGroups(unit: string): string[] {
  const value = /^SupplementaryGroups=(.*)$/m.exec(unit)?.[1]?.trim();
  return value === undefined || value === "" ? [] : value.split(/\s+/u);
}

describe("host log broker systemd source-only boundary", () => {
  it("keeps host-log authority behind one dedicated local client group", () => {
    expect(brokerUnit).toContain("# SOURCE-ONLY BLUEPRINT.");
    expect(brokerUnit).toContain("User=root");
    expect(brokerUnit).toContain("Group=dashboard-rpi5-log-client");
    expect(supplementaryGroups(brokerUnit)).toEqual([]);
    expect(brokerUnit).toContain(
      "Environment=DASHBOARD_LOG_BROKER_SOCKET=/run/dashboard-rpi5-log-broker/broker.sock",
    );
    expect(brokerUnit).toContain(
      "ExecStart=/usr/bin/node /opt/dashboard_RPi5/current/apps/agent/dist/log-broker-entry.js",
    );

    const agentSupplementaryGroups = supplementaryGroups(agentUnit);
    expect(agentSupplementaryGroups).toEqual([
      "dashboard-rpi5-docker-client",
      "dashboard-rpi5-log-client",
    ]);
    for (const forbidden of ["docker", "video", "adm", "systemd-journal", "sudo"]) {
      expect(agentSupplementaryGroups).not.toContain(forbidden);
    }
    expect(agentUnit).not.toContain("User=root");
    expect(agentUnit).toContain(
      "Environment=DASHBOARD_LOG_BROKER_SOCKET=/run/dashboard-rpi5-log-broker/broker.sock",
    );
  });

  it("keeps the host-log broker local-only, read-oriented and strongly sandboxed", () => {
    for (const directive of [
      "RuntimeDirectory=dashboard-rpi5-log-broker",
      "RuntimeDirectoryMode=0750",
      "UMask=0007",
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
      "ProtectProc=invisible",
      "ProcSubset=pid",
      "LockPersonality=yes",
      "RestrictNamespaces=yes",
      "RestrictSUIDSGID=yes",
      "RestrictRealtime=yes",
      "RestrictAddressFamilies=AF_UNIX",
      "SystemCallArchitectures=native",
      "TasksMax=48",
      "MemoryMax=192M",
    ]) {
      expect(brokerUnit).toContain(directive);
    }

    expect(brokerUnit).not.toContain("DASHBOARD_DOCKER_SOCKET_PATH");
    expect(brokerUnit).not.toContain("DASHBOARD_DOCKER_BROKER_SOCKET");
    expect(brokerUnit).not.toContain("dashboard-rpi5-terminal");
    expect(brokerUnit).not.toMatch(/ListenStream=(?:\d|127\.|0\.0\.0\.0|\[)/);
  });

  it("keeps activation explicitly outside source merge authority", () => {
    expect(brokerUnit).toContain("Do not install, enable, start, restart");
    expect(agentUnit).toContain("# SOURCE-ONLY BLUEPRINT.");
  });
});
