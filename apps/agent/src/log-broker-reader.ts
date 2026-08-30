import type { LogRange, LogSnapshot, LogSourceId } from "@dashboard-rpi5/contracts/logs";
import { execFile as nodeExecFile } from "node:child_process";

import { readProductionBackupLogTail, type DescriptorSafeFileTailResult } from "./log-broker-file.js";
import { isLogBrokerSourceId } from "./log-broker-protocol.js";
import {
  JOURNALCTL_PATH,
  LOG_FILE_TAIL_BYTES,
  LOG_MAX_ENTRIES,
  LOG_MAX_SOURCE_BYTES,
  LOG_SOURCE_TIMEOUT_MS,
  LogSourceUnavailableError,
  parseFileTail,
  parseJournalJsonLines,
  readLogSnapshot,
  type LogReadDependencies,
} from "./logs-read.js";
import { getProductionLogSourceDescriptor } from "./production-log-sources.js";

export const SYSTEMCTL_PATH = "/usr/bin/systemctl";
const SYSTEMCTL_MAX_BUFFER_BYTES = 16 * 1024;

const SYSTEMD_UNIT_BY_SOURCE = Object.freeze<Readonly<Partial<Record<LogSourceId, string>>>>({
  "systemd:docker": "docker.service",
  "systemd:ssh": "ssh.service",
  "systemd:cron": "cron.service",
  "systemd:dashboard-rpi5-agent": "dashboard-rpi5-agent.service",
  "systemd:rpi5-update": "rpi5-update.service",
  "systemd:cloudflared": "cloudflared.service",
  "systemd:rpi5-monitor": "rpi5-monitor.service",
  "systemd:rpi5-post-reboot": "rpi5-post-reboot.service",
  "systemd:rpi5-tmp-headroom": "rpi5-tmp-headroom.service",
  "systemd:rpi5-dashboard-evidence": "rpi5-dashboard-evidence.service",
  "systemd:hermes-tech-web": "hermes-tech-web.service",
});

const JOURNAL_SINCE: Readonly<Record<LogRange, string>> = {
  "15m": "-15min",
  "1h": "-1h",
  "6h": "-6h",
  "24h": "-24h",
};

export interface LogBrokerReaderDependencies {
  now(): Date;
  execFile: LogReadDependencies["execFile"];
  readRegistered(
    sourceId: LogSourceId,
    range: LogRange,
    signal?: AbortSignal,
  ): Promise<LogSnapshot>;
  readBackupFileTail(maxBytes: number, signal?: AbortSignal): Promise<DescriptorSafeFileTailResult>;
}

const defaultDependencies: LogBrokerReaderDependencies = {
  now: () => new Date(),
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
  readRegistered: (sourceId, range, signal) =>
    readLogSnapshot(sourceId, range, undefined, signal),
  readBackupFileTail: readProductionBackupLogTail,
};

export function logBrokerSystemdUnitForSource(sourceId: LogSourceId): string | null {
  return SYSTEMD_UNIT_BY_SOURCE[sourceId] ?? null;
}

export function buildLogBrokerJournalctlArgs(
  sourceId: LogSourceId,
  range: LogRange,
): readonly string[] {
  const unit = logBrokerSystemdUnitForSource(sourceId);
  if (unit === null) throw new LogSourceUnavailableError();
  return [
    "--no-pager",
    "--output=json",
    "--output-fields=__REALTIME_TIMESTAMP,PRIORITY,MESSAGE,SYSLOG_IDENTIFIER,_SYSTEMD_UNIT,_UID,_TRANSPORT",
    `--unit=${unit}`,
    `--since=${JOURNAL_SINCE[range]}`,
    `--lines=${LOG_MAX_ENTRIES}`,
  ];
}

async function assertSystemdUnitAvailable(
  unit: string,
  dependencies: LogBrokerReaderDependencies,
  signal?: AbortSignal,
): Promise<void> {
  const { stdout } = await dependencies.execFile(
    SYSTEMCTL_PATH,
    ["show", "--property=LoadState", "--value", unit],
    {
      timeout: LOG_SOURCE_TIMEOUT_MS,
      maxBuffer: SYSTEMCTL_MAX_BUFFER_BYTES,
      encoding: "utf8",
      shell: false,
      ...(signal === undefined ? {} : { signal }),
    },
  );
  const loadState = stdout.trim();
  if (loadState.length === 0 || loadState === "not-found" || loadState === "error") {
    throw new LogSourceUnavailableError();
  }
}

export async function readBrokerLogSnapshot(
  sourceId: LogSourceId,
  range: LogRange,
  dependencies: LogBrokerReaderDependencies = defaultDependencies,
  signal?: AbortSignal,
): Promise<LogSnapshot> {
  try {
    signal?.throwIfAborted();
    if (!isLogBrokerSourceId(sourceId)) throw new LogSourceUnavailableError();

    const descriptor = getProductionLogSourceDescriptor(sourceId);
    if (descriptor === undefined || descriptor.kind === "DOCKER") {
      throw new LogSourceUnavailableError();
    }

    if (descriptor.kind === "FILE") {
      const observedAt = dependencies.now();
      if (!Number.isFinite(observedAt.getTime())) throw new LogSourceUnavailableError();
      const tail = await dependencies.readBackupFileTail(LOG_FILE_TAIL_BYTES, signal);
      const parsed = parseFileTail(tail.text, tail.truncated);
      signal?.throwIfAborted();
      return {
        observedAt: observedAt.toISOString(),
        source: descriptor,
        range,
        rangeApplied: false,
        entries: parsed.entries,
        truncated: parsed.truncated,
      };
    }

    if (descriptor.kind !== "SYSTEMD") {
      return await dependencies.readRegistered(sourceId, range, signal);
    }

    const unit = logBrokerSystemdUnitForSource(sourceId);
    if (unit === null) throw new LogSourceUnavailableError();
    await assertSystemdUnitAvailable(unit, dependencies, signal);

    const observedAt = dependencies.now();
    if (!Number.isFinite(observedAt.getTime())) throw new LogSourceUnavailableError();
    const { stdout } = await dependencies.execFile(
      JOURNALCTL_PATH,
      buildLogBrokerJournalctlArgs(sourceId, range),
      {
        timeout: LOG_SOURCE_TIMEOUT_MS,
        maxBuffer: LOG_MAX_SOURCE_BYTES,
        encoding: "utf8",
        shell: false,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    const parsed = parseJournalJsonLines(stdout);
    signal?.throwIfAborted();
    return {
      observedAt: observedAt.toISOString(),
      source: descriptor,
      range,
      rangeApplied: true,
      entries: parsed.entries,
      truncated: parsed.truncated,
    };
  } catch (error: unknown) {
    if (error instanceof LogSourceUnavailableError) throw error;
    throw new LogSourceUnavailableError();
  }
}
