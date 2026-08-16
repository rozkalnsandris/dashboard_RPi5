import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const socketUnit = readFileSync(
  new URL("../../../ops/systemd/dashboard-rpi5-terminal.socket", import.meta.url),
  "utf8",
);
const serviceUnit = readFileSync(
  new URL("../../../ops/systemd/dashboard-rpi5-terminal@.service", import.meta.url),
  "utf8",
);

describe("terminal systemd source-only containment blueprint", () => {
  it("uses one local Unix socket connection per service instance", () => {
    expect(socketUnit).toContain("# SOURCE-ONLY BLUEPRINT.");
    expect(socketUnit).toContain("ListenStream=/run/dashboard-rpi5-terminal.sock");
    expect(socketUnit).toContain("SocketUser=root");
    expect(socketUnit).toContain("SocketGroup=dashboard-rpi5-terminal-client");
    expect(socketUnit).toContain("SocketMode=0660");
    expect(socketUnit).toContain("Accept=yes");
    expect(socketUnit).toContain("MaxConnections=1");
    expect(socketUnit).toContain("Backlog=1");
    expect(socketUnit).toContain("RemoveOnStop=yes");
    expect(socketUnit).toContain("Service=dashboard-rpi5-terminal@.service");
    expect(socketUnit).not.toMatch(/ListenStream=(?:\d|127\.|0\.0\.0\.0|\[)/);
  });

  it("makes systemd PID 1 the process-tree cleanup authority without cgroup delegation", () => {
    expect(serviceUnit).toContain("# SOURCE-ONLY BLUEPRINT.");
    expect(serviceUnit).toContain("User=dashboard-rpi5-terminal");
    expect(serviceUnit).toContain("Group=dashboard-rpi5-terminal");
    expect(serviceUnit).toMatch(/^SupplementaryGroups=$/m);
    expect(serviceUnit).toContain("StandardInput=socket");
    expect(serviceUnit).toContain("StandardOutput=socket");
    expect(serviceUnit).toContain("KillMode=control-group");
    expect(serviceUnit).toContain("SendSIGKILL=yes");
    expect(serviceUnit).toContain("TimeoutStopSec=2s");
    expect(serviceUnit).toContain("RuntimeMaxSec=30min");
    expect(serviceUnit).toContain("Restart=no");
    expect(serviceUnit).not.toMatch(/^Delegate=/m);
    expect(serviceUnit).not.toMatch(/^ExitType=cgroup$/m);
  });

  it("keeps the terminal service unprivileged and blocks local control sockets", () => {
    for (const directive of [
      "NoNewPrivileges=yes",
      "CapabilityBoundingSet=",
      "AmbientCapabilities=",
      "PrivateTmp=yes",
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
      "TasksMax=64",
      "MemoryMax=256M",
    ]) {
      expect(serviceUnit).toContain(directive);
    }

    expect(serviceUnit).toContain("-/run/docker.sock");
    expect(serviceUnit).toContain("-/var/run/docker.sock");
    expect(serviceUnit).toContain("-/run/dbus/system_bus_socket");
    expect(serviceUnit).toContain("-/run/systemd/private");
    expect(serviceUnit).not.toContain("User=root");
    expect(serviceUnit).not.toContain("sudo");
  });
});
