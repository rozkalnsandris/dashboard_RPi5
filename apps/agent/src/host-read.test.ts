import { describe, expect, it, vi } from "vitest";

import {
  CPU_SAMPLE_WINDOW_MS,
  HostEvidenceParseError,
  HostSourceUnavailableError,
  THERMAL_ZONE_TEMP_PATH,
  VCGENCMD_MAX_BUFFER_BYTES,
  VCGENCMD_PATH,
  VCGENCMD_TIMEOUT_MS,
  calculateCpuUsagePercent,
  calculateFilesystemUsage,
  parseCpuSnapshot,
  parseMemoryInfo,
  parseThermalZoneTemperature,
  parseThrottleState,
  readHostSummary,
  type HostReadDependencies,
} from "./host-read.js";

function makeDependencies(
  overrides: Partial<HostReadDependencies> = {},
): HostReadDependencies {
  let cpuRead = 0;
  return {
    async readTextFile(path) {
      if (path === "/proc/stat") {
        cpuRead += 1;
        return cpuRead === 1
          ? "cpu 100 0 50 850 0 0 0 0 0 0\n"
          : "cpu 120 0 60 900 0 0 0 0 0 0\n";
      }
      if (path === "/proc/meminfo") {
        return [
          "MemTotal:       8388608 kB",
          "MemFree:        1048576 kB",
          "MemAvailable:   5242880 kB",
          "SwapTotal:      1048576 kB",
          "SwapFree:        786432 kB",
          "",
        ].join("\n");
      }
      if (path === "/proc/loadavg") return "0.25 0.50 0.75 1/100 123\n";
      if (path === "/proc/uptime") return "12345.67 45678.90\n";
      if (path === THERMAL_ZONE_TEMP_PATH) return "43200\n";
      throw new Error("unexpected test path");
    },
    async statFilesystem() {
      return { bsize: 4096n, blocks: 1000n, bavail: 250n };
    },
    async execFile(_file, args) {
      if (args[0] === "get_throttled") return { stdout: "throttled=0x50005\n" };
      throw new Error("unexpected test command");
    },
    async sleep() {},
    now() {
      return new Date("2026-08-15T13:00:00.000Z");
    },
    ...overrides,
  };
}

describe("host evidence parsers", () => {
  it("calculates aggregate CPU usage from monotonic /proc/stat snapshots", () => {
    const first = parseCpuSnapshot("cpu 100 0 50 850 0 0 0 0 0 0\n");
    const second = parseCpuSnapshot("cpu 120 0 60 900 0 0 0 0 0 0\n");
    expect(calculateCpuUsagePercent(first, second)).toBe(37.5);
  });

  it("rejects non-monotonic and zero-delta CPU evidence", () => {
    const first = parseCpuSnapshot("cpu 100 0 50 850 0 0 0 0\n");
    expect(() =>
      calculateCpuUsagePercent(
        first,
        parseCpuSnapshot("cpu 99 0 50 851 0 0 0 0\n"),
      ),
    ).toThrow(HostEvidenceParseError);
    expect(() => calculateCpuUsagePercent(first, first)).toThrow(
      HostEvidenceParseError,
    );
  });

  it("uses MemAvailable and reports nullable swap percentage when swap is disabled", () => {
    expect(
      parseMemoryInfo(
        [
          "MemTotal:       1000 kB",
          "MemAvailable:    250 kB",
          "SwapTotal:         0 kB",
          "SwapFree:          0 kB",
        ].join("\n"),
      ),
    ).toEqual({
      totalBytes: 1_024_000,
      availableBytes: 256_000,
      usedBytes: 768_000,
      usedPercent: 75,
      swapTotalBytes: 0,
      swapFreeBytes: 0,
      swapUsedBytes: 0,
      swapUsedPercent: null,
    });
  });

  it("rejects impossible memory evidence", () => {
    expect(() =>
      parseMemoryInfo(
        [
          "MemTotal:       1000 kB",
          "MemAvailable:   1001 kB",
          "SwapTotal:         0 kB",
          "SwapFree:          0 kB",
        ].join("\n"),
      ),
    ).toThrow(HostEvidenceParseError);
  });

  it("calculates root filesystem usage from blocks available to the service identity", () => {
    expect(
      calculateFilesystemUsage({ bsize: 4096n, blocks: 1000n, bavail: 250n }),
    ).toEqual({
      path: "/",
      totalBytes: 4_096_000,
      availableBytes: 1_024_000,
      usedBytes: 3_072_000,
      usedPercent: 75,
    });
  });

  it("strictly parses the unprivileged thermal-zone millidegree source", () => {
    expect(parseThermalZoneTemperature("43200\n")).toBe(43.2);
    expect(parseThermalZoneTemperature("-5000\n")).toBe(-5);
    expect(() => parseThermalZoneTemperature("43.2")).toThrow(HostEvidenceParseError);
    expect(() => parseThermalZoneTemperature("temp=43.2'C")).toThrow(HostEvidenceParseError);
    expect(() => parseThermalZoneTemperature("999000")).toThrow(HostEvidenceParseError);
  });

  it("decodes current and historical Raspberry Pi throttle flags when evidence is available", () => {
    expect(parseThrottleState("throttled=0xf000f\n")).toEqual({
      rawHex: "0xf000f",
      rawValue: 0xf000f,
      current: {
        underVoltage: true,
        armFrequencyCapped: true,
        throttled: true,
        softTemperatureLimit: true,
      },
      occurred: {
        underVoltage: true,
        armFrequencyCapped: true,
        throttled: true,
        softTemperatureLimit: true,
      },
    });
  });
});

describe("readHostSummary", () => {
  it("returns required host metrics from least-privilege sources and keeps available throttle evidence", async () => {
    const dependencies = makeDependencies();
    const readTextFile = vi.fn(dependencies.readTextFile);
    const execFile = vi.fn(dependencies.execFile);
    const sleep = vi.fn(async () => undefined);

    const summary = await readHostSummary(
      makeDependencies({ readTextFile, execFile, sleep }),
    );

    expect(summary).toEqual({
      observedAt: "2026-08-15T13:00:00.000Z",
      uptimeSeconds: 12345.67,
      loadAverage: {
        oneMinute: 0.25,
        fiveMinutes: 0.5,
        fifteenMinutes: 0.75,
      },
      cpu: { usagePercent: 37.5, sampleWindowMs: CPU_SAMPLE_WINDOW_MS },
      memory: {
        totalBytes: 8_589_934_592,
        availableBytes: 5_368_709_120,
        usedBytes: 3_221_225_472,
        usedPercent: 37.5,
        swapTotalBytes: 1_073_741_824,
        swapFreeBytes: 805_306_368,
        swapUsedBytes: 268_435_456,
        swapUsedPercent: 25,
      },
      filesystem: {
        path: "/",
        totalBytes: 4_096_000,
        availableBytes: 1_024_000,
        usedBytes: 3_072_000,
        usedPercent: 75,
      },
      temperature: { celsius: 43.2 },
      throttle: {
        rawHex: "0x50005",
        rawValue: 0x50005,
        current: {
          underVoltage: true,
          armFrequencyCapped: false,
          throttled: true,
          softTemperatureLimit: false,
        },
        occurred: {
          underVoltage: true,
          armFrequencyCapped: false,
          throttled: true,
          softTemperatureLimit: false,
        },
      },
    });

    expect(readTextFile).toHaveBeenCalledWith(THERMAL_ZONE_TEMP_PATH);
    expect(sleep).toHaveBeenCalledWith(CPU_SAMPLE_WINDOW_MS, undefined);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile).toHaveBeenCalledWith(
      VCGENCMD_PATH,
      ["get_throttled"],
      {
        timeout: VCGENCMD_TIMEOUT_MS,
        maxBuffer: VCGENCMD_MAX_BUFFER_BYTES,
        encoding: "utf8",
        shell: false,
      },
    );
  });

  it("keeps required live host metrics when firmware throttle evidence is inaccessible", async () => {
    const summary = await readHostSummary(
      makeDependencies({
        async execFile() {
          throw new Error("permission denied");
        },
      }),
    );

    expect(summary.temperature).toEqual({ celsius: 43.2 });
    expect(summary.cpu.usagePercent).toBe(37.5);
    expect(summary.throttle).toEqual({ state: "UNAVAILABLE" });
  });

  it("does not fabricate throttle evidence when firmware output is malformed", async () => {
    const summary = await readHostSummary(
      makeDependencies({
        async execFile() {
          return { stdout: "throttled=not-a-value\n" };
        },
      }),
    );

    expect(summary.throttle).toEqual({ state: "UNAVAILABLE" });
  });

  it("still fails closed when a required source is malformed", async () => {
    const base = makeDependencies();
    const dependencies = makeDependencies({
      async readTextFile(path) {
        if (path === "/proc/meminfo") return "MemTotal: 1000 kB\n";
        return base.readTextFile(path);
      },
    });

    await expect(readHostSummary(dependencies)).rejects.toBeInstanceOf(
      HostSourceUnavailableError,
    );
  });

  it("fails closed when the required sysfs temperature is missing or malformed", async () => {
    const base = makeDependencies();
    const malformed = makeDependencies({
      async readTextFile(path) {
        if (path === THERMAL_ZONE_TEMP_PATH) return "43.2\n";
        return base.readTextFile(path);
      },
    });
    await expect(readHostSummary(malformed)).rejects.toBeInstanceOf(
      HostSourceUnavailableError,
    );

    const missingBase = makeDependencies();
    const missing = makeDependencies({
      async readTextFile(path) {
        if (path === THERMAL_ZONE_TEMP_PATH) throw new Error("not found");
        return missingBase.readTextFile(path);
      },
    });
    await expect(readHostSummary(missing)).rejects.toBeInstanceOf(
      HostSourceUnavailableError,
    );
  });
});
