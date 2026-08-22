import type { HostSummary, HostThrottleFlags } from "@dashboard-rpi5/contracts";

import { readRootOwnedEvidenceJson } from "./evidence-file.js";

export const THROTTLE_EVIDENCE_SCHEMA_VERSION = "dashboard-rpi5.throttle-evidence.v1" as const;
export const DEFAULT_THROTTLE_EVIDENCE_PATH = "/var/lib/dashboard-rpi5/evidence/throttle.json";
export const DEFAULT_THROTTLE_EVIDENCE_MAX_BYTES = 64 * 1024;
export const DEFAULT_THROTTLE_EVIDENCE_MAX_AGE_MS = 10 * 60 * 1000;

export interface ThrottleEvidenceReadOptions {
  path?: string;
  maxBytes?: number;
  requiredUid?: number;
  maxAgeMs?: number;
  now?: () => Date;
}

export class ThrottleSourceUnavailableError extends Error {
  constructor() {
    super("Throttle evidence source unavailable");
    this.name = "ThrottleSourceUnavailableError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function decodeThrottleFlags(value: number, offset: 0 | 16): HostThrottleFlags {
  return {
    underVoltage: (value & (1 << (offset + 0))) !== 0,
    armFrequencyCapped: (value & (1 << (offset + 1))) !== 0,
    throttled: (value & (1 << (offset + 2))) !== 0,
    softTemperatureLimit: (value & (1 << (offset + 3))) !== 0,
  };
}

function validateMaxAge(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 60 * 60 * 1000) {
    throw new RangeError("Throttle evidence maxAgeMs outside allowed range");
  }
  return value;
}

export function parseThrottleEvidence(
  value: unknown,
  now: Date,
  maxAgeMs: number = DEFAULT_THROTTLE_EVIDENCE_MAX_AGE_MS,
): Exclude<HostSummary["throttle"], { state: "UNAVAILABLE" }> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["schema", "observedAt", "rawHex"]) ||
    value.schema !== THROTTLE_EVIDENCE_SCHEMA_VERSION ||
    typeof value.observedAt !== "string" ||
    typeof value.rawHex !== "string" ||
    !/^0x[0-9a-f]+$/.test(value.rawHex)
  ) {
    throw new ThrottleSourceUnavailableError();
  }

  const observedMs = Date.parse(value.observedAt);
  const nowMs = now.getTime();
  if (
    !Number.isFinite(observedMs) ||
    !Number.isFinite(nowMs) ||
    new Date(observedMs).toISOString() !== value.observedAt ||
    observedMs > nowMs ||
    nowMs - observedMs > validateMaxAge(maxAgeMs)
  ) {
    throw new ThrottleSourceUnavailableError();
  }

  const rawValue = Number.parseInt(value.rawHex.slice(2), 16);
  if (!Number.isSafeInteger(rawValue) || rawValue < 0 || rawValue > 0xffff_ffff) {
    throw new ThrottleSourceUnavailableError();
  }

  return {
    rawHex: value.rawHex,
    rawValue,
    current: decodeThrottleFlags(rawValue, 0),
    occurred: decodeThrottleFlags(rawValue, 16),
  };
}

export async function readThrottleEvidence(
  options: ThrottleEvidenceReadOptions = {},
  signal?: AbortSignal,
): Promise<Exclude<HostSummary["throttle"], { state: "UNAVAILABLE" }>> {
  try {
    const value = await readRootOwnedEvidenceJson(
      {
        path: options.path ?? DEFAULT_THROTTLE_EVIDENCE_PATH,
        maxBytes: options.maxBytes ?? DEFAULT_THROTTLE_EVIDENCE_MAX_BYTES,
        requiredUid: options.requiredUid ?? 0,
      },
      signal,
    );
    return parseThrottleEvidence(
      value,
      (options.now ?? (() => new Date()))(),
      options.maxAgeMs ?? DEFAULT_THROTTLE_EVIDENCE_MAX_AGE_MS,
    );
  } catch (error) {
    if (error instanceof ThrottleSourceUnavailableError) throw error;
    throw new ThrottleSourceUnavailableError();
  }
}
