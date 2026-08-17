import type { HostSummary, HostThrottleFlags } from "@dashboard-rpi5/contracts";
import { execFile as nodeExecFile } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import { setTimeout as sleepTimer } from "node:timers/promises";

export const CPU_SAMPLE_WINDOW_MS = 200;
export const THERMAL_ZONE_TEMP_PATH = "/sys/class/thermal/thermal_zone0/temp";
export const VCGENCMD_PATH = "/usr/bin/vcgencmd";
export const VCGENCMD_TIMEOUT_MS = 1_000;
export const VCGENCMD_MAX_BUFFER_BYTES = 4_096;

interface FilesystemStat {
  bsize: bigint;
  blocks: bigint;
  bavail: bigint;
}

interface ExecFileOptions {
  timeout: number;
  maxBuffer: number;
  encoding: "utf8";
  shell: false;
  signal?: AbortSignal;
}

interface ExecFileResult {
  stdout: string;
}

export interface HostReadDependencies {
  readTextFile(path: string): Promise<string>;
  statFilesystem(path: string): Promise<FilesystemStat>;
  execFile(
    file: string,
    args: readonly string[],
    options: ExecFileOptions,
  ): Promise<ExecFileResult>;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  now(): Date;
}

export class HostEvidenceParseError extends Error {
  constructor() {
    super("Host evidence is malformed");
    this.name = "HostEvidenceParseError";
  }
}

export class HostSourceUnavailableError extends Error {
  constructor() {
    super("Required host evidence is unavailable");
    this.name = "HostSourceUnavailableError";
  }
}

const defaultDependencies: HostReadDependencies = {
  async readTextFile(path) {
    return readFile(path, "utf8");
  },
  async statFilesystem(path) {
    const result = await statfs(path, { bigint: true });
    return {
      bsize: result.bsize,
      blocks: result.blocks,
      bavail: result.bavail,
    };
  },
  async execFile(file, args, options) {
    return new Promise((resolve, reject) => {
      nodeExecFile(
        file,
        [...args],
        options,
        (error, stdout) => {
          if (error !== null) {
            reject(error);
            return;
          }

          resolve({ stdout });
        },
      );
    });
  },
  async sleep(ms, signal) {
    await sleepTimer(ms, undefined, signal === undefined ? undefined : { signal });
  },
  now() {
    return new Date();
  },
};

interface CpuSnapshot {
  values: readonly number[];
  total: number;
  idle: number;
}

function parseSafeNonNegativeInteger(value: string): number {
  if (!/^\d+$/.test(value)) throw new HostEvidenceParseError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new HostEvidenceParseError();
  }
  return parsed;
}

export function parseCpuSnapshot(input: string): CpuSnapshot {
  const line = input.split("\n", 1)[0]?.trim();
  if (line === undefined) throw new HostEvidenceParseError();

  const fields = line.split(/\s+/);
  if (fields[0] !== "cpu" || fields.length < 9) {
    throw new HostEvidenceParseError();
  }

  const values = fields.slice(1, 9).map(parseSafeNonNegativeInteger);
  const total = values.reduce((sum, value) => sum + value, 0);
  const idle = (values[3] ?? 0) + (values[4] ?? 0);

  if (!Number.isSafeInteger(total) || total <= 0 || idle > total) {
    throw new HostEvidenceParseError();
  }

  return { values, total, idle };
}

export function calculateCpuUsagePercent(
  first: CpuSnapshot,
  second: CpuSnapshot,
): number {
  if (
    first.values.length !== second.values.length ||
    second.values.some((value, index) => value < (first.values[index] ?? 0))
  ) {
    throw new HostEvidenceParseError();
  }

  const totalDelta = second.total - first.total;
  const idleDelta = second.idle - first.idle;
  const busyDelta = totalDelta - idleDelta;

  if (totalDelta <= 0 || idleDelta < 0 || busyDelta < 0 || busyDelta > totalDelta) {
    throw new HostEvidenceParseError();
  }

  const percent = (busyDelta / totalDelta) * 100;
  return Math.min(100, Math.max(0, Number(percent.toFixed(2))));
}

export function parseMemoryInfo(input: string): HostSummary["memory"] {
  const values = new Map<string, number>();

  for (const line of input.split("\n")) {
    const match = /^([A-Za-z()_]+):\s+(\d+)\s+kB$/.exec(line.trim());
    if (match === null) continue;
    values.set(match[1] ?? "", parseSafeNonNegativeInteger(match[2] ?? ""));
  }

  const required = ["MemTotal", "MemAvailable", "SwapTotal", "SwapFree"] as const;
  if (required.some((key) => !values.has(key))) {
    throw new HostEvidenceParseError();
  }

  const totalBytes = (values.get("MemTotal") ?? 0) * 1_024;
  const availableBytes = (values.get("MemAvailable") ?? 0) * 1_024;
  const swapTotalBytes = (values.get("SwapTotal") ?? 0) * 1_024;
  const swapFreeBytes = (values.get("SwapFree") ?? 0) * 1_024;

  if (
    totalBytes <= 0 ||
    availableBytes > totalBytes ||
    swapFreeBytes > swapTotalBytes ||
    ![totalBytes, availableBytes, swapTotalBytes, swapFreeBytes].every(Number.isSafeInteger)
  ) {
    throw new HostEvidenceParseError();
  }

  const usedBytes = totalBytes - availableBytes;
  const swapUsedBytes = swapTotalBytes - swapFreeBytes;

  return {
    totalBytes,
    availableBytes,
    usedBytes,
    usedPercent: Number(((usedBytes / totalBytes) * 100).toFixed(2)),
    swapTotalBytes,
    swapFreeBytes,
    swapUsedBytes,
    swapUsedPercent:
      swapTotalBytes === 0
        ? null
        : Number(((swapUsedBytes / swapTotalBytes) * 100).toFixed(2)),
  };
}

export function parseLoadAverage(input: string): HostSummary["loadAverage"] {
  const fields = input.trim().split(/\s+/);
  if (fields.length < 3) throw new HostEvidenceParseError();

  const values = fields.slice(0, 3).map((field) => Number(field));
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new HostEvidenceParseError();
  }

  return {
    oneMinute: values[0] ?? 0,
    fiveMinutes: values[1] ?? 0,
    fifteenMinutes: values[2] ?? 0,
  };
}

export function parseUptimeSeconds(input: string): number {
  const first = input.trim().split(/\s+/, 1)[0];
  const value = Number(first);
  if (first === undefined || first.length === 0 || !Number.isFinite(value) || value < 0) {
    throw new HostEvidenceParseError();
  }
  return value;
}

function safeBigIntToNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new HostEvidenceParseError();
  }
  return Number(value);
}

export function calculateFilesystemUsage(
  stat: FilesystemStat,
): HostSummary["filesystem"] {
  if (stat.bsize <= 0n || stat.blocks <= 0n || stat.bavail < 0n || stat.bavail > stat.blocks) {
    throw new HostEvidenceParseError();
  }

  const totalBytes = safeBigIntToNumber(stat.bsize * stat.blocks);
  const availableBytes = safeBigIntToNumber(stat.bsize * stat.bavail);
  const usedBytes = totalBytes - availableBytes;

  return {
    path: "/",
    totalBytes,
    availableBytes,
    usedBytes,
    usedPercent: Number(((usedBytes / totalBytes) * 100).toFixed(2)),
  };
}

export function parseThermalZoneTemperature(input: string): number {
  const raw = input.trim();
  if (!/^-?\d+$/.test(raw)) throw new HostEvidenceParseError();

  const millidegrees = Number(raw);
  if (!Number.isSafeInteger(millidegrees)) throw new HostEvidenceParseError();

  const celsius = millidegrees / 1_000;
  if (!Number.isFinite(celsius) || celsius < -40 || celsius > 150) {
    throw new HostEvidenceParseError();
  }
  return celsius;
}

function decodeThrottleFlags(value: number, offset: 0 | 16): HostThrottleFlags {
  return {
    underVoltage: (value & (1 << (offset + 0))) !== 0,
    armFrequencyCapped: (value & (1 << (offset + 1))) !== 0,
    throttled: (value & (1 << (offset + 2))) !== 0,
    softTemperatureLimit: (value & (1 << (offset + 3))) !== 0,
  };
}

export function parseThrottleState(input: string): Exclude<HostSummary["throttle"], { state: "UNAVAILABLE" }> {
  const match = /^throttled=(0x[0-9a-fA-F]+)$/.exec(input.trim());
  if (match === null) throw new HostEvidenceParseError();

  const rawHex = (match[1] ?? "").toLowerCase();
  const rawValue = Number.parseInt(rawHex.slice(2), 16);
  if (!Number.isSafeInteger(rawValue) || rawValue < 0 || rawValue > 0xffff_ffff) {
    throw new HostEvidenceParseError();
  }

  return {
    rawHex,
    rawValue,
    current: decodeThrottleFlags(rawValue, 0),
    occurred: decodeThrottleFlags(rawValue, 16),
  };
}

async function readThrottleState(
  dependencies: HostReadDependencies,
  signal?: AbortSignal,
): Promise<HostSummary["throttle"]> {
  try {
    const { stdout } = await dependencies.execFile(VCGENCMD_PATH, ["get_throttled"], {
      timeout: VCGENCMD_TIMEOUT_MS,
      maxBuffer: VCGENCMD_MAX_BUFFER_BYTES,
      encoding: "utf8",
      shell: false,
      ...(signal === undefined ? {} : { signal }),
    });
    return parseThrottleState(stdout);
  } catch {
    signal?.throwIfAborted();
    return { state: "UNAVAILABLE" };
  }
}

async function sampleCpuUsage(
  dependencies: HostReadDependencies,
  signal?: AbortSignal,
): Promise<number> {
  const first = parseCpuSnapshot(await dependencies.readTextFile("/proc/stat"));
  await dependencies.sleep(CPU_SAMPLE_WINDOW_MS, signal);
  const second = parseCpuSnapshot(await dependencies.readTextFile("/proc/stat"));
  return calculateCpuUsagePercent(first, second);
}

export async function readHostSummary(
  dependencies: HostReadDependencies = defaultDependencies,
  signal?: AbortSignal,
): Promise<HostSummary> {
  try {
    signal?.throwIfAborted();

    const [
      cpuUsagePercent,
      memoryText,
      loadAverageText,
      uptimeText,
      filesystemStat,
      temperatureText,
      throttle,
    ] = await Promise.all([
      sampleCpuUsage(dependencies, signal),
      dependencies.readTextFile("/proc/meminfo"),
      dependencies.readTextFile("/proc/loadavg"),
      dependencies.readTextFile("/proc/uptime"),
      dependencies.statFilesystem("/"),
      dependencies.readTextFile(THERMAL_ZONE_TEMP_PATH),
      readThrottleState(dependencies, signal),
    ]);

    signal?.throwIfAborted();

    return {
      observedAt: dependencies.now().toISOString(),
      uptimeSeconds: parseUptimeSeconds(uptimeText),
      loadAverage: parseLoadAverage(loadAverageText),
      cpu: {
        usagePercent: cpuUsagePercent,
        sampleWindowMs: CPU_SAMPLE_WINDOW_MS,
      },
      memory: parseMemoryInfo(memoryText),
      filesystem: calculateFilesystemUsage(filesystemStat),
      temperature: { celsius: parseThermalZoneTemperature(temperatureText) },
      throttle,
    };
  } catch (error: unknown) {
    if (error instanceof HostSourceUnavailableError) throw error;
    throw new HostSourceUnavailableError();
  }
}
