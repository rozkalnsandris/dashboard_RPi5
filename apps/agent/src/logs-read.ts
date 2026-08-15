import type {
  LogEntry,
  LogLevel,
  LogRange,
  LogSnapshot,
  LogSourceDescriptor,
  LogSourceId,
  LogSourcesSnapshot,
  LogStream,
} from "@dashboard-rpi5/contracts/logs";
import { execFile as nodeExecFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { request } from "node:http";

import { DOCKER_API_PREFIX, DOCKER_SOCKET_PATH } from "./docker-read.js";

export const LOG_MAX_ENTRIES = 400;
export const LOG_MAX_MESSAGE_CHARS = 8_192;
export const LOG_MAX_SOURCE_BYTES = 512 * 1024;
export const LOG_FILE_TAIL_BYTES = 256 * 1024;
export const LOG_SOURCE_TIMEOUT_MS = 1_500;
export const JOURNALCTL_PATH = "/usr/bin/journalctl";

interface DockerLogSourceRegistration {
  descriptor: LogSourceDescriptor;
  kind: "DOCKER";
  containerName: string;
}

interface SystemdLogSourceRegistration {
  descriptor: LogSourceDescriptor;
  kind: "SYSTEMD";
  unitId: string;
}

interface JournalLogSourceRegistration {
  descriptor: LogSourceDescriptor;
  kind: "JOURNAL";
  matches: readonly string[];
}

interface FileLogSourceRegistration {
  descriptor: LogSourceDescriptor;
  kind: "FILE";
  path: string;
}

type LogSourceRegistration =
  | DockerLogSourceRegistration
  | SystemdLogSourceRegistration
  | JournalLogSourceRegistration
  | FileLogSourceRegistration;

export const LOG_SOURCE_REGISTRY = Object.freeze<readonly LogSourceRegistration[]>([
  {
    descriptor: {
      sourceId: "docker:homeassistant",
      label: "Home Assistant",
      kind: "DOCKER",
      rangeMode: "TIME",
    },
    kind: "DOCKER",
    containerName: "homeassistant",
  },
  {
    descriptor: {
      sourceId: "docker:prometheus",
      label: "Prometheus",
      kind: "DOCKER",
      rangeMode: "TIME",
    },
    kind: "DOCKER",
    containerName: "prometheus",
  },
  {
    descriptor: {
      sourceId: "systemd:docker",
      label: "Docker Engine",
      kind: "SYSTEMD",
      rangeMode: "TIME",
    },
    kind: "SYSTEMD",
    unitId: "docker.service",
  },
  {
    descriptor: {
      sourceId: "systemd:ssh",
      label: "SSH",
      kind: "SYSTEMD",
      rangeMode: "TIME",
    },
    kind: "SYSTEMD",
    unitId: "ssh.service",
  },
  {
    descriptor: {
      sourceId: "systemd:cron",
      label: "Cron scheduler",
      kind: "SYSTEMD",
      rangeMode: "TIME",
    },
    kind: "SYSTEMD",
    unitId: "cron.service",
  },
  {
    descriptor: {
      sourceId: "systemd:dashboard-rpi5-agent",
      label: "Dashboard agent",
      kind: "SYSTEMD",
      rangeMode: "TIME",
    },
    kind: "SYSTEMD",
    unitId: "dashboard-rpi5-agent.service",
  },
  {
    descriptor: {
      sourceId: "systemd:rpi5-update",
      label: "RPi5 maintenance",
      kind: "SYSTEMD",
      rangeMode: "TIME",
    },
    kind: "SYSTEMD",
    unitId: "rpi5-update.service",
  },
  {
    descriptor: {
      sourceId: "journal:rpi5-deploy",
      label: "RPi5 deploy",
      kind: "JOURNAL",
      rangeMode: "TIME",
    },
    kind: "JOURNAL",
    matches: ["_UID=0", "_TRANSPORT=syslog", "SYSLOG_IDENTIFIER=rpi5-deploy"],
  },
  {
    descriptor: {
      sourceId: "file:rpi5-backup",
      label: "RPi5 backup",
      kind: "FILE",
      rangeMode: "TAIL",
    },
    kind: "FILE",
    path: "/var/log/rpi5-backup.log",
  },
]);

const RANGE_SECONDS: Record<LogRange, number> = {
  "15m": 15 * 60,
  "1h": 60 * 60,
  "6h": 6 * 60 * 60,
  "24h": 24 * 60 * 60,
};

const JOURNAL_SINCE: Record<LogRange, string> = {
  "15m": "-15min",
  "1h": "-1h",
  "6h": "-6h",
  "24h": "-24h",
};

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

interface TailReadResult {
  text: string;
  truncated: boolean;
}

export interface LogReadDependencies {
  now(): Date;
  execFile(
    file: string,
    args: readonly string[],
    options: ExecFileOptions,
  ): Promise<ExecFileResult>;
  readFileTail(path: string, maxBytes: number, signal?: AbortSignal): Promise<TailReadResult>;
  readDockerLogs(
    containerName: string,
    sinceSeconds: number,
    signal?: AbortSignal,
  ): Promise<Buffer>;
}

export class LogSourceUnavailableError extends Error {
  constructor() {
    super("Required log evidence is unavailable");
    this.name = "LogSourceUnavailableError";
  }
}

function findRegistration(sourceId: LogSourceId): LogSourceRegistration {
  const registration = LOG_SOURCE_REGISTRY.find(
    (candidate) => candidate.descriptor.sourceId === sourceId,
  );
  if (registration === undefined) throw new LogSourceUnavailableError();
  return registration;
}

function cloneDescriptor(descriptor: LogSourceDescriptor): LogSourceDescriptor {
  return { ...descriptor };
}

function normalizeIsoTimestamp(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (match === null) return null;
  const fraction = (match[2] ?? "").padEnd(3, "0").slice(0, 3);
  const normalized = `${match[1]}.${fraction}Z`;
  const milliseconds = Date.parse(normalized);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function sanitizeMessage(value: string): string {
  const sanitized = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "�")
    .replace(/\r$/u, "");
  if (sanitized.length === 0) return "(empty log message)";
  return sanitized.slice(0, LOG_MAX_MESSAGE_CHARS);
}

function splitTimestampedLine(value: string): { timestamp: string | null; message: string } {
  const separator = value.indexOf(" ");
  if (separator <= 0) return { timestamp: null, message: sanitizeMessage(value) };
  const timestamp = normalizeIsoTimestamp(value.slice(0, separator));
  if (timestamp === null) return { timestamp: null, message: sanitizeMessage(value) };
  return { timestamp, message: sanitizeMessage(value.slice(separator + 1)) };
}

function toSequencedEntries(
  entries: Omit<LogEntry, "sequence">[],
): { entries: LogEntry[]; truncated: boolean } {
  const truncated = entries.length > LOG_MAX_ENTRIES;
  const bounded = entries.slice(-LOG_MAX_ENTRIES);
  return {
    entries: bounded.map((entry, sequence) => ({ ...entry, sequence })),
    truncated,
  };
}

interface DockerFrame {
  stream: LogStream;
  payload: Buffer;
}

function parseDockerFrames(body: Buffer): DockerFrame[] | null {
  if (body.length < 8) return null;
  const firstStream = body[0];
  if (
    (firstStream !== 1 && firstStream !== 2) ||
    body[1] !== 0 ||
    body[2] !== 0 ||
    body[3] !== 0
  ) {
    return null;
  }

  const frames: DockerFrame[] = [];
  let offset = 0;
  while (offset < body.length) {
    if (body.length - offset < 8) throw new LogSourceUnavailableError();
    const streamByte = body[offset];
    if (
      (streamByte !== 1 && streamByte !== 2) ||
      body[offset + 1] !== 0 ||
      body[offset + 2] !== 0 ||
      body[offset + 3] !== 0
    ) {
      throw new LogSourceUnavailableError();
    }
    const length = body.readUInt32BE(offset + 4);
    offset += 8;
    if (length > LOG_MAX_SOURCE_BYTES || offset + length > body.length) {
      throw new LogSourceUnavailableError();
    }
    frames.push({
      stream: streamByte === 1 ? "STDOUT" : "STDERR",
      payload: body.subarray(offset, offset + length),
    });
    offset += length;
  }
  return frames;
}

function parseDockerTextChunks(frames: DockerFrame[]): Omit<LogEntry, "sequence">[] {
  const pending: Record<"STDOUT" | "STDERR", string> = { STDOUT: "", STDERR: "" };
  const entries: Omit<LogEntry, "sequence">[] = [];

  const emitCompleteLines = (stream: "STDOUT" | "STDERR", text: string) => {
    const combined = pending[stream] + text;
    const parts = combined.split("\n");
    pending[stream] = parts.pop() ?? "";
    for (const line of parts) {
      if (line.length === 0) continue;
      const parsed = splitTimestampedLine(line);
      entries.push({
        timestamp: parsed.timestamp,
        level: "UNKNOWN",
        stream,
        message: parsed.message,
      });
    }
  };

  for (const frame of frames) {
    const stream = frame.stream === "STDERR" ? "STDERR" : "STDOUT";
    emitCompleteLines(stream, frame.payload.toString("utf8"));
  }

  for (const stream of ["STDOUT", "STDERR"] as const) {
    if (pending[stream].length === 0) continue;
    const parsed = splitTimestampedLine(pending[stream]);
    entries.push({
      timestamp: parsed.timestamp,
      level: "UNKNOWN",
      stream,
      message: parsed.message,
    });
  }

  return entries;
}

export function parseDockerLogBody(body: Buffer): { entries: LogEntry[]; truncated: boolean } {
  if (body.length > LOG_MAX_SOURCE_BYTES) throw new LogSourceUnavailableError();
  if (body.length === 0) return { entries: [], truncated: false };

  const frames = parseDockerFrames(body);
  if (frames !== null) return toSequencedEntries(parseDockerTextChunks(frames));

  const entries = body
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map<Omit<LogEntry, "sequence">>((line) => {
      const parsed = splitTimestampedLine(line);
      return {
        timestamp: parsed.timestamp,
        level: "UNKNOWN",
        stream: "COMBINED",
        message: parsed.message,
      };
    });
  return toSequencedEntries(entries);
}

function mapJournalPriority(value: unknown): LogLevel {
  const priority = typeof value === "string" && /^\d$/.test(value) ? Number(value) : NaN;
  if (priority <= 2) return "CRITICAL";
  if (priority === 3) return "ERROR";
  if (priority === 4) return "WARN";
  if (priority === 5) return "NOTICE";
  if (priority === 6) return "INFO";
  if (priority === 7) return "DEBUG";
  return "UNKNOWN";
}

function parseJournalTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  try {
    const microseconds = BigInt(value);
    const milliseconds = microseconds / 1_000n;
    if (milliseconds < 0n || milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return new Date(Number(milliseconds)).toISOString();
  } catch {
    return null;
  }
}

export function parseJournalJsonLines(stdout: string): { entries: LogEntry[]; truncated: boolean } {
  if (Buffer.byteLength(stdout, "utf8") > LOG_MAX_SOURCE_BYTES) {
    throw new LogSourceUnavailableError();
  }

  const entries: Omit<LogEntry, "sequence">[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new LogSourceUnavailableError();
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new LogSourceUnavailableError();
    }
    const record = value as Record<string, unknown>;
    if (typeof record.MESSAGE !== "string" || record.MESSAGE.length === 0) continue;
    entries.push({
      timestamp: parseJournalTimestamp(record.__REALTIME_TIMESTAMP),
      level: mapJournalPriority(record.PRIORITY),
      stream: "JOURNAL",
      message: sanitizeMessage(record.MESSAGE),
    });
  }

  return toSequencedEntries(entries);
}

function parseStrictFileTimestamp(line: string): { timestamp: string | null; message: string } {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z)\s+(.*)$/u.exec(line);
  if (match === null) return { timestamp: null, message: sanitizeMessage(line) };
  const timestamp = normalizeIsoTimestamp(match[1] ?? "");
  if (timestamp === null) return { timestamp: null, message: sanitizeMessage(line) };
  return { timestamp, message: sanitizeMessage(match[2] ?? "") };
}

export function parseFileTail(text: string, tailWasTruncated: boolean): {
  entries: LogEntry[];
  truncated: boolean;
} {
  const rawLines = text.split("\n");
  if (tailWasTruncated && rawLines.length > 0) rawLines.shift();
  const entries = rawLines
    .filter((line) => line.length > 0)
    .map<Omit<LogEntry, "sequence">>((line) => {
      const parsed = parseStrictFileTimestamp(line);
      return {
        timestamp: parsed.timestamp,
        level: "UNKNOWN",
        stream: "FILE",
        message: parsed.message,
      };
    });
  const sequenced = toSequencedEntries(entries);
  return { entries: sequenced.entries, truncated: tailWasTruncated || sequenced.truncated };
}

export function buildJournalctlArgs(sourceId: LogSourceId, range: LogRange): readonly string[] {
  const registration = findRegistration(sourceId);
  const base = [
    "--no-pager",
    "--output=json",
    "--output-fields=__REALTIME_TIMESTAMP,PRIORITY,MESSAGE,SYSLOG_IDENTIFIER,_SYSTEMD_UNIT,_UID,_TRANSPORT",
  ];
  if (registration.kind === "SYSTEMD") {
    return [
      ...base,
      `--unit=${registration.unitId}`,
      `--since=${JOURNAL_SINCE[range]}`,
      `--lines=${LOG_MAX_ENTRIES}`,
    ];
  }
  if (registration.kind === "JOURNAL") {
    return [
      ...base,
      `--since=${JOURNAL_SINCE[range]}`,
      `--lines=${LOG_MAX_ENTRIES}`,
      ...registration.matches,
    ];
  }
  throw new LogSourceUnavailableError();
}

export function buildDockerLogsPath(
  sourceId: LogSourceId,
  range: LogRange,
  now: Date,
): string {
  const registration = findRegistration(sourceId);
  if (registration.kind !== "DOCKER") throw new LogSourceUnavailableError();
  const observedSeconds = Math.floor(now.getTime() / 1_000);
  if (!Number.isSafeInteger(observedSeconds) || observedSeconds < 0) {
    throw new LogSourceUnavailableError();
  }
  const since = Math.max(0, observedSeconds - RANGE_SECONDS[range]);
  return `${DOCKER_API_PREFIX}/containers/${encodeURIComponent(registration.containerName)}/logs?stdout=true&stderr=true&since=${since}&timestamps=true&tail=${LOG_MAX_ENTRIES}`;
}

async function defaultReadDockerLogs(
  containerName: string,
  sinceSeconds: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(containerName)) {
    throw new LogSourceUnavailableError();
  }
  if (!Number.isSafeInteger(sinceSeconds) || sinceSeconds < 0) {
    throw new LogSourceUnavailableError();
  }
  const path = `${DOCKER_API_PREFIX}/containers/${encodeURIComponent(containerName)}/logs?stdout=true&stderr=true&since=${sinceSeconds}&timestamps=true&tail=${LOG_MAX_ENTRIES}`;

  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      reject(new LogSourceUnavailableError());
    };
    const succeed = (body: Buffer) => {
      if (settled) return;
      settled = true;
      resolve(body);
    };

    const req = request(
      {
        socketPath: DOCKER_SOCKET_PATH,
        path,
        method: "GET",
        ...(signal === undefined ? {} : { signal }),
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          fail();
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer | string) => {
          if (settled) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buffer.length;
          if (total > LOG_MAX_SOURCE_BYTES) {
            response.destroy();
            fail();
            return;
          }
          chunks.push(buffer);
        });
        response.once("error", fail);
        response.once("end", () => succeed(Buffer.concat(chunks)));
      },
    );
    req.setTimeout(LOG_SOURCE_TIMEOUT_MS, () => req.destroy(new LogSourceUnavailableError()));
    req.once("error", fail);
    req.end();
  });
}

async function defaultReadFileTail(
  path: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<TailReadResult> {
  signal?.throwIfAborted();
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 0) throw new LogSourceUnavailableError();
  const start = Math.max(0, metadata.size - maxBytes);
  const truncated = start > 0;

  return new Promise<TailReadResult>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const stream = createReadStream(path, {
      start,
      ...(metadata.size === 0 ? {} : { end: metadata.size - 1 }),
      ...(signal === undefined ? {} : { signal }),
    });
    stream.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        stream.destroy(new LogSourceUnavailableError());
        return;
      }
      chunks.push(buffer);
    });
    stream.once("error", () => reject(new LogSourceUnavailableError()));
    stream.once("end", () => resolve({ text: Buffer.concat(chunks).toString("utf8"), truncated }));
  });
}

const defaultDependencies: LogReadDependencies = {
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
  readFileTail: defaultReadFileTail,
  readDockerLogs: defaultReadDockerLogs,
};

export function listRegisteredLogSources(now: Date = new Date()): LogSourcesSnapshot {
  if (!Number.isFinite(now.getTime())) throw new LogSourceUnavailableError();
  return {
    observedAt: now.toISOString(),
    sources: LOG_SOURCE_REGISTRY.map((registration) => cloneDescriptor(registration.descriptor)),
  };
}

export async function readLogSnapshot(
  sourceId: LogSourceId,
  range: LogRange,
  dependencies: LogReadDependencies = defaultDependencies,
  signal?: AbortSignal,
): Promise<LogSnapshot> {
  try {
    signal?.throwIfAborted();
    const registration = findRegistration(sourceId);
    const observedAt = dependencies.now();
    if (!Number.isFinite(observedAt.getTime())) throw new LogSourceUnavailableError();

    let parsed: { entries: LogEntry[]; truncated: boolean };
    if (registration.kind === "DOCKER") {
      const observedSeconds = Math.floor(observedAt.getTime() / 1_000);
      const sinceSeconds = Math.max(0, observedSeconds - RANGE_SECONDS[range]);
      const body = await dependencies.readDockerLogs(
        registration.containerName,
        sinceSeconds,
        signal,
      );
      parsed = parseDockerLogBody(body);
    } else if (registration.kind === "SYSTEMD" || registration.kind === "JOURNAL") {
      const { stdout } = await dependencies.execFile(
        JOURNALCTL_PATH,
        buildJournalctlArgs(sourceId, range),
        {
          timeout: LOG_SOURCE_TIMEOUT_MS,
          maxBuffer: LOG_MAX_SOURCE_BYTES,
          encoding: "utf8",
          shell: false,
          ...(signal === undefined ? {} : { signal }),
        },
      );
      parsed = parseJournalJsonLines(stdout);
    } else {
      const tail = await dependencies.readFileTail(registration.path, LOG_FILE_TAIL_BYTES, signal);
      parsed = parseFileTail(tail.text, tail.truncated);
    }

    signal?.throwIfAborted();
    return {
      observedAt: observedAt.toISOString(),
      source: cloneDescriptor(registration.descriptor),
      range,
      rangeApplied: registration.kind !== "FILE",
      entries: parsed.entries,
      truncated: parsed.truncated,
    };
  } catch (error: unknown) {
    if (error instanceof LogSourceUnavailableError) throw error;
    throw new LogSourceUnavailableError();
  }
}
