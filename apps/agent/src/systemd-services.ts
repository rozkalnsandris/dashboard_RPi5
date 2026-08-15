import type {
  SystemdServiceActiveState,
  SystemdServiceEnablement,
  SystemdServiceLoadState,
  SystemdServiceSnapshot,
  SystemdServicesSnapshot,
} from "@dashboard-rpi5/contracts/services";
import { execFile as nodeExecFile } from "node:child_process";
import { readFile } from "node:fs/promises";

export const SYSTEMCTL_PATH = "/usr/bin/systemctl";
export const SYSTEMCTL_TIMEOUT_MS = 1_000;
export const SYSTEMCTL_MAX_BUFFER_BYTES = 8 * 1024;

export const SYSTEMD_SERVICE_REGISTRY = Object.freeze([
  { unitId: "dashboard-rpi5-agent.service", label: "Dashboard agent" },
  { unitId: "docker.service", label: "Docker Engine" },
  { unitId: "ssh.service", label: "SSH" },
  { unitId: "cron.service", label: "Cron scheduler" },
] as const);

const SYSTEMCTL_PROPERTIES = Object.freeze([
  "Id",
  "LoadState",
  "ActiveState",
  "SubState",
  "UnitFileState",
  "NRestarts",
  "ActiveEnterTimestampMonotonic",
  "ActiveExitTimestampMonotonic",
  "InactiveEnterTimestampMonotonic",
  "InactiveExitTimestampMonotonic",
] as const);
const SYSTEMCTL_PROPERTY_SET = new Set<string>(SYSTEMCTL_PROPERTIES);
const SUB_STATE_PATTERN = /^[A-Za-z0-9_-]+$/;

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

export interface SystemdReadDependencies {
  readTextFile(path: string): Promise<string>;
  execFile(
    file: string,
    args: readonly string[],
    options: ExecFileOptions,
  ): Promise<ExecFileResult>;
  now(): Date;
}

const defaultDependencies: SystemdReadDependencies = {
  async readTextFile(path) {
    return readFile(path, "utf8");
  },
  async execFile(file, args, options) {
    return new Promise((resolve, reject) => {
      nodeExecFile(file, [...args], options, (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve({ stdout });
      });
    });
  },
  now() {
    return new Date();
  },
};

export class SystemdEvidenceParseError extends Error {
  constructor() {
    super("Systemd evidence is malformed");
    this.name = "SystemdEvidenceParseError";
  }
}

export class SystemdSourceUnavailableError extends Error {
  constructor() {
    super("Required systemd evidence is unavailable");
    this.name = "SystemdSourceUnavailableError";
  }
}

function normalizeLoadState(value: string | undefined): SystemdServiceLoadState {
  switch (value) {
    case "loaded":
      return "LOADED";
    case "not-found":
      return "NOT_FOUND";
    case "bad-setting":
      return "BAD_SETTING";
    case "error":
      return "ERROR";
    case "masked":
      return "MASKED";
    default:
      return "UNKNOWN";
  }
}

function normalizeActiveState(value: string | undefined): SystemdServiceActiveState {
  switch (value) {
    case "active":
      return "ACTIVE";
    case "reloading":
      return "RELOADING";
    case "inactive":
      return "INACTIVE";
    case "failed":
      return "FAILED";
    case "activating":
      return "ACTIVATING";
    case "deactivating":
      return "DEACTIVATING";
    case "maintenance":
      return "MAINTENANCE";
    case "refreshing":
      return "REFRESHING";
    default:
      return "UNKNOWN";
  }
}

function normalizeEnablement(value: string | undefined): SystemdServiceEnablement {
  switch (value) {
    case "enabled":
      return "ENABLED";
    case "enabled-runtime":
      return "ENABLED_RUNTIME";
    case "disabled":
      return "DISABLED";
    case "static":
      return "STATIC";
    case "masked":
      return "MASKED";
    case "masked-runtime":
      return "MASKED_RUNTIME";
    case "indirect":
      return "INDIRECT";
    case "generated":
      return "GENERATED";
    case "transient":
      return "TRANSIENT";
    case "alias":
      return "ALIAS";
    case "linked":
      return "LINKED";
    case "linked-runtime":
      return "LINKED_RUNTIME";
    default:
      return "UNKNOWN";
  }
}

function parseProperties(input: string): Map<string, string> {
  const properties = new Map<string, string>();
  for (const rawLine of input.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new SystemdEvidenceParseError();
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!SYSTEMCTL_PROPERTY_SET.has(key) || properties.has(key)) {
      throw new SystemdEvidenceParseError();
    }
    properties.set(key, value);
  }
  return properties;
}

function parseOptionalSafeInteger(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  if (!/^\d+$/.test(value)) throw new SystemdEvidenceParseError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new SystemdEvidenceParseError();
  return parsed;
}

function parseHostUptimeUsec(input: string): number {
  const first = input.trim().split(/\s+/, 1)[0];
  if (first === undefined || first === "") throw new SystemdEvidenceParseError();
  const seconds = Number(first);
  const usec = seconds * 1_000_000;
  if (!Number.isFinite(usec) || usec < 0 || usec > Number.MAX_SAFE_INTEGER) {
    throw new SystemdEvidenceParseError();
  }
  return usec;
}

function parseStateAgeSeconds(properties: Map<string, string>, uptimeUsec: number): number | null {
  const timestamps = [
    "ActiveEnterTimestampMonotonic",
    "ActiveExitTimestampMonotonic",
    "InactiveEnterTimestampMonotonic",
    "InactiveExitTimestampMonotonic",
  ].map((key) => parseOptionalSafeInteger(properties.get(key)) ?? 0);
  const latest = Math.max(...timestamps);
  if (latest === 0) return null;
  if (latest > uptimeUsec + 5_000_000) throw new SystemdEvidenceParseError();
  return Number((Math.max(0, uptimeUsec - latest) / 1_000_000).toFixed(3));
}

export function buildSystemctlArgs(unitId: string): readonly string[] {
  const registryEntry = SYSTEMD_SERVICE_REGISTRY.find((entry) => entry.unitId === unitId);
  if (registryEntry === undefined) throw new SystemdEvidenceParseError();
  return [
    "show",
    "--no-pager",
    ...SYSTEMCTL_PROPERTIES.map((property) => `--property=${property}`),
    registryEntry.unitId,
  ];
}

export function parseSystemdServiceOutput(
  input: string,
  expectedUnitId: string,
  label: string,
  uptimeUsec: number,
): SystemdServiceSnapshot {
  if (!SYSTEMD_SERVICE_REGISTRY.some((entry) => entry.unitId === expectedUnitId && entry.label === label)) {
    throw new SystemdEvidenceParseError();
  }

  const properties = parseProperties(input);
  const loadState = normalizeLoadState(properties.get("LoadState"));
  const id = properties.get("Id");
  if (id !== expectedUnitId && !(id === undefined && loadState === "NOT_FOUND")) {
    throw new SystemdEvidenceParseError();
  }

  const rawSubState = properties.get("SubState") ?? "";
  if (rawSubState.length > 64 || (rawSubState !== "" && !SUB_STATE_PATTERN.test(rawSubState))) {
    throw new SystemdEvidenceParseError();
  }

  return {
    unitId: expectedUnitId,
    label,
    loadState,
    activeState: normalizeActiveState(properties.get("ActiveState")),
    subState: rawSubState === "" ? null : rawSubState,
    enablement: normalizeEnablement(properties.get("UnitFileState")),
    restartCount: parseOptionalSafeInteger(properties.get("NRestarts")),
    stateAgeSeconds: parseStateAgeSeconds(properties, uptimeUsec),
  };
}

export async function readSystemdServices(
  dependencies: SystemdReadDependencies = defaultDependencies,
  signal?: AbortSignal,
): Promise<SystemdServicesSnapshot> {
  try {
    signal?.throwIfAborted();
    const uptimeUsec = parseHostUptimeUsec(await dependencies.readTextFile("/proc/uptime"));
    const services = await Promise.all(
      SYSTEMD_SERVICE_REGISTRY.map(async ({ unitId, label }) => {
        const { stdout } = await dependencies.execFile(SYSTEMCTL_PATH, buildSystemctlArgs(unitId), {
          timeout: SYSTEMCTL_TIMEOUT_MS,
          maxBuffer: SYSTEMCTL_MAX_BUFFER_BYTES,
          encoding: "utf8",
          shell: false,
          ...(signal === undefined ? {} : { signal }),
        });
        return parseSystemdServiceOutput(stdout, unitId, label, uptimeUsec);
      }),
    );
    signal?.throwIfAborted();
    return { observedAt: dependencies.now().toISOString(), services };
  } catch (error: unknown) {
    if (error instanceof SystemdSourceUnavailableError) throw error;
    throw new SystemdSourceUnavailableError();
  }
}
