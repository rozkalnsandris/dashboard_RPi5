import { describe, expect, it, vi } from "vitest";

import {
  buildSystemctlArgs,
  parseSystemdServiceOutput,
  readSystemdServices,
  SYSTEMCTL_MAX_BUFFER_BYTES,
  SYSTEMCTL_PATH,
  SYSTEMCTL_TIMEOUT_MS,
  SYSTEMD_SERVICE_REGISTRY,
  SystemdEvidenceParseError,
  SystemdSourceUnavailableError,
  type SystemdReadDependencies,
} from "./systemd-services.js";

const loadedOutput = [
  "Id=docker.service",
  "LoadState=loaded",
  "ActiveState=active",
  "SubState=running",
  "UnitFileState=enabled",
  "NRestarts=2",
  "ActiveEnterTimestampMonotonic=10000000",
  "ActiveExitTimestampMonotonic=0",
  "InactiveEnterTimestampMonotonic=0",
  "InactiveExitTimestampMonotonic=0",
  "",
].join("\n");

describe("Phase 5A systemd service reader", () => {
  it("builds argv only for source-owned allowlisted service IDs", () => {
    const args = buildSystemctlArgs("docker.service");
    expect(args[0]).toBe("show");
    expect(args.at(-1)).toBe("docker.service");
    expect(args).toContain("--property=ActiveState");
    expect(args).toContain("--property=NRestarts");
    expect(() => buildSystemctlArgs("user-controlled.service")).toThrow(SystemdEvidenceParseError);
  });

  it("normalizes loaded active service evidence and derives state age from monotonic time", () => {
    expect(parseSystemdServiceOutput(loadedOutput, "docker.service", "Docker Engine", 20_000_000)).toEqual({
      unitId: "docker.service",
      label: "Docker Engine",
      loadState: "LOADED",
      activeState: "ACTIVE",
      subState: "running",
      enablement: "ENABLED",
      restartCount: 2,
      stateAgeSeconds: 10,
    });
  });

  it("keeps not-found and unknown future states explicit instead of inventing healthy state", () => {
    const notFound = [
      "LoadState=not-found",
      "ActiveState=inactive",
      "SubState=dead",
      "UnitFileState=",
      "NRestarts=",
      "ActiveEnterTimestampMonotonic=0",
      "ActiveExitTimestampMonotonic=0",
      "InactiveEnterTimestampMonotonic=0",
      "InactiveExitTimestampMonotonic=0",
    ].join("\n");
    expect(parseSystemdServiceOutput(notFound, "dashboard-rpi5-agent.service", "Dashboard agent", 20_000_000)).toMatchObject({
      loadState: "NOT_FOUND",
      activeState: "INACTIVE",
      enablement: "UNKNOWN",
      restartCount: null,
      stateAgeSeconds: null,
    });

    const futureState = loadedOutput.replace("ActiveState=active", "ActiveState=future-active");
    expect(parseSystemdServiceOutput(futureState, "docker.service", "Docker Engine", 20_000_000).activeState).toBe("UNKNOWN");
  });

  it("rejects mismatched IDs, unexpected properties and impossible monotonic timestamps", () => {
    expect(() =>
      parseSystemdServiceOutput(loadedOutput.replace("Id=docker.service", "Id=ssh.service"), "docker.service", "Docker Engine", 20_000_000),
    ).toThrow(SystemdEvidenceParseError);
    expect(() =>
      parseSystemdServiceOutput(`${loadedOutput}Description=unrequested\n`, "docker.service", "Docker Engine", 20_000_000),
    ).toThrow(SystemdEvidenceParseError);
    expect(() =>
      parseSystemdServiceOutput(loadedOutput, "docker.service", "Docker Engine", 1_000_000),
    ).toThrow(SystemdEvidenceParseError);
  });

  it("executes fixed systemctl reads for exactly the registry and preserves bounded options", async () => {
    const execFile = vi.fn<SystemdReadDependencies["execFile"]>(async (_file, args) => {
      const unitId = args.at(-1);
      if (unitId === undefined) throw new Error("missing unit");
      return {
        stdout: [
          `Id=${unitId}`,
          "LoadState=loaded",
          "ActiveState=active",
          "SubState=running",
          "UnitFileState=enabled",
          "NRestarts=0",
          "ActiveEnterTimestampMonotonic=1000000",
          "ActiveExitTimestampMonotonic=0",
          "InactiveEnterTimestampMonotonic=0",
          "InactiveExitTimestampMonotonic=0",
        ].join("\n"),
      };
    });
    const dependencies: SystemdReadDependencies = {
      readTextFile: async (path) => {
        expect(path).toBe("/proc/uptime");
        return "10.00 5.00\n";
      },
      execFile,
      now: () => new Date("2026-08-15T15:00:00.000Z"),
    };

    const snapshot = await readSystemdServices(dependencies);
    expect(snapshot.observedAt).toBe("2026-08-15T15:00:00.000Z");
    expect(snapshot.services.map((service) => service.unitId)).toEqual(
      SYSTEMD_SERVICE_REGISTRY.map((entry) => entry.unitId),
    );
    expect(execFile).toHaveBeenCalledTimes(SYSTEMD_SERVICE_REGISTRY.length);
    for (const [file, args, options] of execFile.mock.calls) {
      expect(file).toBe(SYSTEMCTL_PATH);
      expect(SYSTEMD_SERVICE_REGISTRY.some((entry) => entry.unitId === args.at(-1))).toBe(true);
      expect(options).toMatchObject({
        timeout: SYSTEMCTL_TIMEOUT_MS,
        maxBuffer: SYSTEMCTL_MAX_BUFFER_BYTES,
        encoding: "utf8",
        shell: false,
      });
    }
  });

  it("normalizes execution failures as source unavailable", async () => {
    const dependencies: SystemdReadDependencies = {
      readTextFile: async () => "10.00 5.00\n",
      execFile: async () => {
        throw new Error("private systemctl detail");
      },
      now: () => new Date(),
    };
    await expect(readSystemdServices(dependencies)).rejects.toBeInstanceOf(SystemdSourceUnavailableError);
  });
});
