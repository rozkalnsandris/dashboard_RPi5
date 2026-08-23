import {
  DEPLOY_MAX_EVENTS,
  parseDeployEventsSnapshot,
  type DeployEventsSnapshot,
  type DeployVerifiedEvent,
} from "@dashboard-rpi5/contracts/deploy";
import { execFile as nodeExecFile } from "node:child_process";

import { readRootOwnedEvidenceJson } from "./evidence-file.js";

export const JOURNALCTL_PATH = "/usr/bin/journalctl";
export const DEPLOY_SYSLOG_IDENTIFIER = "rpi5-deploy" as const;
export const DEPLOY_JOURNAL_TIMEOUT_MS = 1_500;
export const DEPLOY_JOURNAL_MAX_BYTES = 128 * 1024;
export const DEPLOY_JOURNAL_SINCE = "-7d" as const;
export const DEFAULT_DEPLOY_EVIDENCE_PATH = "/var/lib/dashboard-rpi5/evidence/deployments.json";
export const DEFAULT_DEPLOY_EVIDENCE_MAX_BYTES = 64 * 1024;

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

export interface DeployReadDependencies {
  execFile(
    file: string,
    args: readonly string[],
    options: ExecFileOptions,
  ): Promise<ExecFileResult>;
  now(): Date;
}

export interface DeployEvidenceReadOptions {
  path?: string;
  maxBytes?: number;
  requiredUid?: number;
  now?: () => Date;
}

const defaultDependencies: DeployReadDependencies = {
  execFile(file, args, options) {
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
  now: () => new Date(),
};

export class DeploySourceUnavailableError extends Error {
  constructor() {
    super("Required deploy verification evidence is unavailable");
    this.name = "DeploySourceUnavailableError";
  }
}

const PASS_PREFIX = "DEPLOY PASS ";
const PASS_PATTERN = /^DEPLOY PASS transaction=(\d{8}T\d{12}Z-([0-9a-f]{12})) commit=([0-9a-f]{12})$/;

export function buildDeployJournalctlArgs(): readonly string[] {
  return [
    "--no-pager",
    "--output=json",
    "--output-fields=__REALTIME_TIMESTAMP,_UID,_TRANSPORT,SYSLOG_IDENTIFIER,MESSAGE",
    `--since=${DEPLOY_JOURNAL_SINCE}`,
    `--lines=${DEPLOY_MAX_EVENTS}`,
    "_UID=0",
    "_TRANSPORT=syslog",
    `SYSLOG_IDENTIFIER=${DEPLOY_SYSLOG_IDENTIFIER}`,
  ];
}

function parseJournalTimestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new DeploySourceUnavailableError();
  }
  try {
    const microseconds = BigInt(value);
    const milliseconds = microseconds / 1_000n;
    if (milliseconds < 0n || milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new DeploySourceUnavailableError();
    }
    const date = new Date(Number(milliseconds));
    if (!Number.isFinite(date.getTime())) throw new DeploySourceUnavailableError();
    return date.toISOString();
  } catch (error) {
    if (error instanceof DeploySourceUnavailableError) throw error;
    throw new DeploySourceUnavailableError();
  }
}

function parseRecord(record: Record<string, unknown>): DeployVerifiedEvent | null {
  if (
    record._UID !== "0" ||
    record._TRANSPORT !== "syslog" ||
    record.SYSLOG_IDENTIFIER !== DEPLOY_SYSLOG_IDENTIFIER ||
    typeof record.MESSAGE !== "string"
  ) {
    throw new DeploySourceUnavailableError();
  }

  if (!record.MESSAGE.startsWith(PASS_PREFIX)) return null;
  const match = PASS_PATTERN.exec(record.MESSAGE);
  if (match === null || match[2] !== match[3]) {
    throw new DeploySourceUnavailableError();
  }
  return {
    transactionId: match[1]!,
    commit: match[3]!,
    occurredAt: parseJournalTimestamp(record.__REALTIME_TIMESTAMP),
  };
}

export function parseDeployJournalJsonLines(stdout: string): DeployVerifiedEvent[] {
  if (Buffer.byteLength(stdout, "utf8") > DEPLOY_JOURNAL_MAX_BYTES) {
    throw new DeploySourceUnavailableError();
  }

  const events: DeployVerifiedEvent[] = [];
  const byTransaction = new Map<string, DeployVerifiedEvent>();
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new DeploySourceUnavailableError();
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new DeploySourceUnavailableError();
    }
    const event = parseRecord(value as Record<string, unknown>);
    if (event === null) continue;
    const previous = byTransaction.get(event.transactionId);
    if (previous !== undefined) {
      if (previous.commit !== event.commit || previous.occurredAt !== event.occurredAt) {
        throw new DeploySourceUnavailableError();
      }
      continue;
    }
    byTransaction.set(event.transactionId, event);
    events.push(event);
  }

  return events
    .sort((left, right) => {
      const byTime = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
      return byTime !== 0 ? byTime : left.transactionId.localeCompare(right.transactionId);
    })
    .slice(0, DEPLOY_MAX_EVENTS);
}

export async function readDeployEvidence(
  options: DeployEvidenceReadOptions = {},
  signal?: AbortSignal,
): Promise<DeployEventsSnapshot> {
  try {
    const value = await readRootOwnedEvidenceJson(
      {
        path: options.path ?? DEFAULT_DEPLOY_EVIDENCE_PATH,
        maxBytes: options.maxBytes ?? DEFAULT_DEPLOY_EVIDENCE_MAX_BYTES,
        requiredUid: options.requiredUid ?? 0,
      },
      signal,
    );
    const parsed = parseDeployEventsSnapshot(value);
    const observedAt = (options.now ?? (() => new Date()))();
    if (!Number.isFinite(observedAt.getTime())) throw new DeploySourceUnavailableError();
    return { observedAt: observedAt.toISOString(), events: parsed.events };
  } catch (error) {
    if (error instanceof DeploySourceUnavailableError) throw error;
    throw new DeploySourceUnavailableError();
  }
}

async function readDeployJournalEvents(
  dependencies: DeployReadDependencies = defaultDependencies,
  signal?: AbortSignal,
): Promise<DeployEventsSnapshot> {
  try {
    signal?.throwIfAborted();
    const { stdout } = await dependencies.execFile(JOURNALCTL_PATH, buildDeployJournalctlArgs(), {
      timeout: DEPLOY_JOURNAL_TIMEOUT_MS,
      maxBuffer: DEPLOY_JOURNAL_MAX_BYTES,
      encoding: "utf8",
      shell: false,
      ...(signal === undefined ? {} : { signal }),
    });
    signal?.throwIfAborted();
    const observedAt = dependencies.now();
    if (!Number.isFinite(observedAt.getTime())) throw new DeploySourceUnavailableError();
    return {
      observedAt: observedAt.toISOString(),
      events: parseDeployJournalJsonLines(stdout),
    };
  } catch (error) {
    if (error instanceof DeploySourceUnavailableError) throw error;
    throw new DeploySourceUnavailableError();
  }
}

export async function readRecentDeployEvents(
  dependencies?: DeployReadDependencies,
  signal?: AbortSignal,
): Promise<DeployEventsSnapshot> {
  if (dependencies === undefined) return readDeployEvidence({}, signal);
  return readDeployJournalEvents(dependencies, signal);
}
