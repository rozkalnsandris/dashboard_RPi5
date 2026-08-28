import type { LogRange, LogSnapshot } from "@dashboard-rpi5/contracts/logs";
import { execFile as nodeExecFile } from "node:child_process";
import { open, stat } from "node:fs/promises";

import {
  JOURNALCTL_PATH,
  LOG_FILE_TAIL_BYTES,
  LOG_MAX_ENTRIES,
  LOG_MAX_SOURCE_BYTES,
  LOG_SOURCE_TIMEOUT_MS,
  LogSourceUnavailableError,
  parseFileTail,
  parseJournalJsonLines,
} from "./logs-read.js";
import { getPrivilegedLogSourceRegistration, type PrivilegedLogSourceId } from "./privileged-log-sources.js";

const JOURNAL_SINCE: Record<LogRange, string> = {
  "15m": "-15min",
  "1h": "-1h",
  "6h": "-6h",
  "24h": "-24h",
};

interface ExecResult { stdout: string; }

export interface PrivilegedLogReadDependencies {
  now(): Date;
  execFile(
    file: string,
    args: readonly string[],
    options: { timeout: number; maxBuffer: number; encoding: "utf8"; shell: false; signal?: AbortSignal },
  ): Promise<ExecResult>;
  readFileTail(path: string, maxBytes: number, signal?: AbortSignal): Promise<{ text: string; truncated: boolean }>;
}

export function buildPrivilegedJournalctlArgs(sourceId: PrivilegedLogSourceId, range: LogRange): readonly string[] {
  const registration = getPrivilegedLogSourceRegistration(sourceId);
  if (registration === null || registration.kind === "FILE") throw new LogSourceUnavailableError();
  const base = [
    "--no-pager",
    "--output=json",
    "--output-fields=__REALTIME_TIMESTAMP,PRIORITY,MESSAGE,SYSLOG_IDENTIFIER,_SYSTEMD_UNIT,_UID,_TRANSPORT",
    `--since=${JOURNAL_SINCE[range]}`,
    `--lines=${LOG_MAX_ENTRIES}`,
  ];
  if (registration.kind === "SYSTEMD") return [...base, `--unit=${registration.unitId}`];
  return [...base, ...registration.matches];
}

async function defaultReadFileTail(path: string, maxBytes: number, signal?: AbortSignal): Promise<{ text: string; truncated: boolean }> {
  signal?.throwIfAborted();
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 0) throw new LogSourceUnavailableError();
  const start = Math.max(0, metadata.size - maxBytes);
  const length = Math.max(0, metadata.size - start);
  if (length === 0) return { text: "", truncated: false };
  const buffer = Buffer.alloc(length);
  const handle = await open(path, "r");
  try {
    const result = await handle.read(buffer, 0, length, start);
    signal?.throwIfAborted();
    return { text: buffer.subarray(0, result.bytesRead).toString("utf8"), truncated: start > 0 };
  } finally {
    await handle.close();
  }
}

const defaultDependencies: PrivilegedLogReadDependencies = {
  now: () => new Date(),
  execFile(file, args, options) {
    return new Promise((resolve, reject) => {
      nodeExecFile(file, [...args], options, (error, stdout) => {
        if (error !== null) { reject(error); return; }
        resolve({ stdout });
      });
    });
  },
  readFileTail: defaultReadFileTail,
};

export async function readPrivilegedLogSnapshot(
  sourceId: PrivilegedLogSourceId,
  range: LogRange,
  signal?: AbortSignal,
  dependencies: PrivilegedLogReadDependencies = defaultDependencies,
): Promise<LogSnapshot> {
  try {
    signal?.throwIfAborted();
    const registration = getPrivilegedLogSourceRegistration(sourceId);
    if (registration === null) throw new LogSourceUnavailableError();
    const observedAt = dependencies.now();
    if (!Number.isFinite(observedAt.getTime())) throw new LogSourceUnavailableError();
    if (registration.kind === "FILE") {
      const tail = await dependencies.readFileTail(registration.path, LOG_FILE_TAIL_BYTES, signal);
      const parsed = parseFileTail(tail.text, tail.truncated);
      return {
        observedAt: observedAt.toISOString(), source: { ...registration.descriptor }, range,
        rangeApplied: false, entries: parsed.entries, truncated: parsed.truncated,
      };
    }
    const { stdout } = await dependencies.execFile(
      JOURNALCTL_PATH,
      buildPrivilegedJournalctlArgs(sourceId, range),
      {
        timeout: LOG_SOURCE_TIMEOUT_MS, maxBuffer: LOG_MAX_SOURCE_BYTES, encoding: "utf8", shell: false,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    const parsed = parseJournalJsonLines(stdout, registration.kind === "JOURNAL" ? registration.origin : undefined);
    return {
      observedAt: observedAt.toISOString(), source: { ...registration.descriptor }, range,
      rangeApplied: true, entries: parsed.entries, truncated: parsed.truncated,
    };
  } catch (error: unknown) {
    if (error instanceof LogSourceUnavailableError) throw error;
    throw new LogSourceUnavailableError();
  }
}
