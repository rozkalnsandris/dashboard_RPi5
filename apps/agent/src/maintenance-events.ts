import {
  MAINTENANCE_MAX_EVENTS,
  parseMaintenanceEventsSnapshot,
  type MaintenanceEvent,
  type MaintenanceEventsSnapshot,
} from "@dashboard-rpi5/contracts/maintenance";
import { execFile as nodeExecFile } from "node:child_process";

import { readRootOwnedEvidenceJson } from "./evidence-file.js";

export const JOURNALCTL_PATH = "/usr/bin/journalctl";
export const MAINTENANCE_UNIT = "rpi5-update.service" as const;
export const MAINTENANCE_SUCCESS_MESSAGE_ID = "7ad2d189f7e94e70a38c781354912448" as const;
export const MAINTENANCE_FAILURE_MESSAGE_ID = "d9b373ed55a64feb8242e02dbe79a49c" as const;
export const MAINTENANCE_JOURNAL_TIMEOUT_MS = 1_500;
export const MAINTENANCE_JOURNAL_MAX_BYTES = 128 * 1024;
export const MAINTENANCE_JOURNAL_SINCE = "-7d" as const;
export const DEFAULT_MAINTENANCE_EVIDENCE_PATH = "/var/lib/dashboard-rpi5/evidence/maintenance.json";
export const DEFAULT_MAINTENANCE_EVIDENCE_MAX_BYTES = 64 * 1024;

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

export interface MaintenanceReadDependencies {
  execFile(
    file: string,
    args: readonly string[],
    options: ExecFileOptions,
  ): Promise<ExecFileResult>;
  now(): Date;
}

export interface MaintenanceEvidenceReadOptions {
  path?: string;
  maxBytes?: number;
  requiredUid?: number;
  now?: () => Date;
}

const defaultDependencies: MaintenanceReadDependencies = {
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

export class MaintenanceSourceUnavailableError extends Error {
  constructor() {
    super("Required maintenance evidence is unavailable");
    this.name = "MaintenanceSourceUnavailableError";
  }
}

const INVOCATION_ID_PATTERN = /^[0-9a-f]{32}$/;
const UNIT_RESULT_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

export function buildMaintenanceJournalctlArgs(): readonly string[] {
  return [
    "--no-pager",
    "--output=json",
    "--output-fields=__REALTIME_TIMESTAMP,MESSAGE_ID,UNIT,INVOCATION_ID,UNIT_RESULT",
    `--since=${MAINTENANCE_JOURNAL_SINCE}`,
    `--lines=${MAINTENANCE_MAX_EVENTS}`,
    `UNIT=${MAINTENANCE_UNIT}`,
    "_PID=1",
    `MESSAGE_ID=${MAINTENANCE_SUCCESS_MESSAGE_ID}`,
    `MESSAGE_ID=${MAINTENANCE_FAILURE_MESSAGE_ID}`,
  ];
}

function parseJournalTimestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new MaintenanceSourceUnavailableError();
  }
  try {
    const microseconds = BigInt(value);
    const milliseconds = microseconds / 1_000n;
    if (milliseconds < 0n || milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new MaintenanceSourceUnavailableError();
    }
    const date = new Date(Number(milliseconds));
    if (!Number.isFinite(date.getTime())) throw new MaintenanceSourceUnavailableError();
    return date.toISOString();
  } catch (error) {
    if (error instanceof MaintenanceSourceUnavailableError) throw error;
    throw new MaintenanceSourceUnavailableError();
  }
}

function parseRecord(record: Record<string, unknown>): MaintenanceEvent {
  if (
    record.UNIT !== MAINTENANCE_UNIT ||
    typeof record.MESSAGE_ID !== "string" ||
    typeof record.INVOCATION_ID !== "string" ||
    !INVOCATION_ID_PATTERN.test(record.INVOCATION_ID)
  ) {
    throw new MaintenanceSourceUnavailableError();
  }

  const occurredAt = parseJournalTimestamp(record.__REALTIME_TIMESTAMP);
  if (record.MESSAGE_ID === MAINTENANCE_SUCCESS_MESSAGE_ID) {
    if (record.UNIT_RESULT !== undefined) throw new MaintenanceSourceUnavailableError();
    return {
      invocationId: record.INVOCATION_ID,
      occurredAt,
      result: "SUCCESS",
      unitResult: null,
    };
  }

  if (record.MESSAGE_ID === MAINTENANCE_FAILURE_MESSAGE_ID) {
    if (typeof record.UNIT_RESULT !== "string" || !UNIT_RESULT_PATTERN.test(record.UNIT_RESULT)) {
      throw new MaintenanceSourceUnavailableError();
    }
    return {
      invocationId: record.INVOCATION_ID,
      occurredAt,
      result: "FAILED",
      unitResult: record.UNIT_RESULT,
    };
  }

  throw new MaintenanceSourceUnavailableError();
}

export function parseMaintenanceJournalJsonLines(stdout: string): MaintenanceEvent[] {
  if (Buffer.byteLength(stdout, "utf8") > MAINTENANCE_JOURNAL_MAX_BYTES) {
    throw new MaintenanceSourceUnavailableError();
  }

  const events: MaintenanceEvent[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new MaintenanceSourceUnavailableError();
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new MaintenanceSourceUnavailableError();
    }
    const event = parseRecord(value as Record<string, unknown>);
    const identity = `${event.invocationId}:${event.occurredAt}:${event.result}:${event.unitResult ?? "none"}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    events.push(event);
  }

  return events
    .sort((left, right) => {
      const byTime = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
      return byTime !== 0 ? byTime : left.invocationId.localeCompare(right.invocationId);
    })
    .slice(0, MAINTENANCE_MAX_EVENTS);
}

export async function readMaintenanceEvidence(
  options: MaintenanceEvidenceReadOptions = {},
  signal?: AbortSignal,
): Promise<MaintenanceEventsSnapshot> {
  try {
    const value = await readRootOwnedEvidenceJson(
      {
        path: options.path ?? DEFAULT_MAINTENANCE_EVIDENCE_PATH,
        maxBytes: options.maxBytes ?? DEFAULT_MAINTENANCE_EVIDENCE_MAX_BYTES,
        requiredUid: options.requiredUid ?? 0,
      },
      signal,
    );
    const parsed = parseMaintenanceEventsSnapshot(value);
    const observedAt = (options.now ?? (() => new Date()))();
    if (!Number.isFinite(observedAt.getTime())) throw new MaintenanceSourceUnavailableError();
    return { observedAt: observedAt.toISOString(), events: parsed.events };
  } catch (error) {
    if (error instanceof MaintenanceSourceUnavailableError) throw error;
    throw new MaintenanceSourceUnavailableError();
  }
}

async function readMaintenanceJournalEvents(
  dependencies: MaintenanceReadDependencies = defaultDependencies,
  signal?: AbortSignal,
): Promise<MaintenanceEventsSnapshot> {
  try {
    signal?.throwIfAborted();
    const { stdout } = await dependencies.execFile(JOURNALCTL_PATH, buildMaintenanceJournalctlArgs(), {
      timeout: MAINTENANCE_JOURNAL_TIMEOUT_MS,
      maxBuffer: MAINTENANCE_JOURNAL_MAX_BYTES,
      encoding: "utf8",
      shell: false,
      ...(signal === undefined ? {} : { signal }),
    });
    signal?.throwIfAborted();
    return {
      observedAt: dependencies.now().toISOString(),
      events: parseMaintenanceJournalJsonLines(stdout),
    };
  } catch (error) {
    if (error instanceof MaintenanceSourceUnavailableError) throw error;
    throw new MaintenanceSourceUnavailableError();
  }
}

export async function readRecentMaintenanceEvents(
  dependencies?: MaintenanceReadDependencies,
  signal?: AbortSignal,
): Promise<MaintenanceEventsSnapshot> {
  if (dependencies === undefined) return readMaintenanceEvidence({}, signal);
  return readMaintenanceJournalEvents(dependencies, signal);
}
