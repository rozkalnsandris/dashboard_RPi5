import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const brokerUnit = readFileSync(
  new URL("../../../ops/systemd/dashboard-rpi5-docker-broker.service", import.meta.url),
  "utf8",
);
const agentUnit = readFileSync(
  new URL("../../../ops/systemd/dashboard-rpi5-agent.service", import.meta.url),
  "utf8",
);

const LINUX_ACCOUNT_NAME_MAX = 32;

function supplementaryGroups(unit: string): string[] {
  const value = /^SupplementaryGroups=(.*)$/m.exec(unit)?.[1]?.trim();
  return value === undefined || value === "" ? [] : value.split(/\s+/u);
}

function systemAccountNames(unit: string): string[] {
  const names: string[] = [];
  for (const match of unit.matchAll(/^(?:User|Group|SupplementaryGroups)=(.*)$/gmu)) {
    const value = match[1]?.trim();
    if (value === undefined || value === "") continue;
    names.push(...value.split(/\s+/u));
  }
  return names;
}

describe("Docker broker systemd source-only boundary", () => {
  it("confines Docker group authority to the dedicated broker identity", () => {
    expect(brokerUnit).toContain("# SOURCE-ONLY BLUEPRINT.");
    expect(brokerUnit).toContain("User=dashboard-rpi5-docker-broker");
    expect(brokerUnit).toContain("Group=dashboard-rpi5-docker-client");
    expect(supplementaryGroups(brokerUnit)).toEqual(["docker"]);
    expect(brokerUnit).toContain("Environment=DASHBOARD_DOCKER_SOCKET_PATH=/var/run/docker.sock");
    expect(brokerUnit).toContain(
      "ExecStart=/usr/bin/node /opt/dashboard_RPi5/current/apps/agent/dist/docker-broker-entry.js",
    );

    expect(agentUnit).toContain("User=dashboard-rpi5-agent");
    expect(agentUnit).toContain("Group=dashboard-rpi5-agent-client");
    const agentSupplementaryGroups = supplementaryGroups(agentUnit);
    expect(agentSupplementaryGroups).toEqual(["dashboard-rpi5-docker-client"]);
    expect(agentSupplementaryGroups).not.toContain("docker");
    expect(agentSupplementaryGroups).not.toContain("video");
    expect(agentUnit).not.toContain("DASHBOARD_DOCKER_SOCKET_PATH");
    expect(agentUnit).toContain(
      "Environment=DASHBOARD_DOCKER_BROKER_SOCKET=/run/dashboard-rpi5-docker-broker/broker.sock",
    );
  });

  it("keeps deploy-time account names within the Linux/Debian bound", () => {
    const names = [...systemAccountNames(brokerUnit), ...systemAccountNames(agentUnit)];
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name.length, `${name} exceeds ${LINUX_ACCOUNT_NAME_MAX} characters`).toBeLessThanOrEqual(
        LINUX_ACCOUNT_NAME_MAX,
      );
    }
  });

  it("keeps the broker local-only and strongly sandboxed", () => {
    for (const directive of [
      "RuntimeDirectory=dashboard-rpi5-docker-broker",
      "RuntimeDirectoryMode=0750",
      "UMask=0007",
      "NoNewPrivileges=yes",
      "CapabilityBoundingSet=",
      "AmbientCapabilities=",
      "PrivateTmp=yes",
      "PrivateDevices=yes",
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
      "TasksMax=64",
      "MemoryMax=256M",
    ]) {
      expect(brokerUnit).toContain(directive);
    }

    expect(brokerUnit).toContain(
      "Environment=DASHBOARD_DOCKER_BROKER_SOCKET=/run/dashboard-rpi5-docker-broker/broker.sock",
    );
    expect(brokerUnit).not.toMatch(/ListenStream=(?:\d|127\.|0\.0\.0\.0|\[)/);
    expect(brokerUnit).not.toContain("sudo");
    expect(brokerUnit).not.toContain("User=root");
  });

  it("preserves unrelated fail-closed capabilities on the main agent", () => {
    expect(agentUnit).toContain("Environment=DASHBOARD_RPI5_QUICK_COMMANDS=disabled");
    expect(agentUnit).toContain("RestrictAddressFamilies=AF_UNIX");
    expect(agentUnit).not.toContain("/dev/vcio");
  });
});
