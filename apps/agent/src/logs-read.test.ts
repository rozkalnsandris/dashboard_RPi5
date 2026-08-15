import { describe, expect, it, vi } from "vitest";

import {
  JOURNALCTL_PATH,
  LOG_MAX_ENTRIES,
  LogSourceUnavailableError,
  buildDockerLogsPath,
  buildJournalctlArgs,
  listRegisteredLogSources,
  parseDockerLogBody,
  parseFileTail,
  parseJournalJsonLines,
  readLogSnapshot,
  type LogReadDependencies,
} from "./logs-read.js";

function dockerFrame(stream: 1 | 2, payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

function dependencies(
  overrides: Partial<LogReadDependencies> = {},
): LogReadDependencies {
  return {
    now: () => new Date("2026-08-15T13:00:00.000Z"),
    execFile: async () => ({ stdout: "" }),
    readFileTail: async () => ({ text: "", truncated: false }),
    readDockerLogs: async () => Buffer.alloc(0),
    ...overrides,
  };
}

describe("registered log source boundary", () => {
  it("returns only stable browser-safe descriptors", () => {
    const snapshot = listRegisteredLogSources(new Date("2026-08-15T13:00:00.000Z"));
    expect(snapshot.sources.map((source) => source.sourceId)).toEqual([
      "docker:homeassistant",
      "docker:prometheus",
      "systemd:docker",
      "systemd:ssh",
      "systemd:cron",
      "systemd:dashboard-rpi5-agent",
      "file:rpi5-backup",
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("/var/log/");
    expect(JSON.stringify(snapshot)).not.toContain("docker.service");
  });

  it("builds journalctl argv only for registered systemd IDs", () => {
    expect(buildJournalctlArgs("systemd:docker", "1h")).toEqual([
      "--no-pager",
      "--output=json",
      "--output-fields=__REALTIME_TIMESTAMP,PRIORITY,MESSAGE,SYSLOG_IDENTIFIER,_SYSTEMD_UNIT",
      "--unit=docker.service",
      "--since=-1h",
      `--lines=${LOG_MAX_ENTRIES}`,
    ]);
    expect(() => buildJournalctlArgs("docker:homeassistant", "1h")).toThrow(
      LogSourceUnavailableError,
    );
  });

  it("builds a fixed Docker logs path from registered IDs and server time", () => {
    const now = new Date("2026-08-15T13:00:00.000Z");
    const since = Math.floor(now.getTime() / 1_000) - 15 * 60;
    expect(buildDockerLogsPath("docker:homeassistant", "15m", now)).toBe(
      `/v1.40/containers/homeassistant/logs?stdout=true&stderr=true&since=${since}&timestamps=true&tail=${LOG_MAX_ENTRIES}`,
    );
    expect(() => buildDockerLogsPath("systemd:docker", "15m", now)).toThrow(
      LogSourceUnavailableError,
    );
  });
});

describe("log parsers", () => {
  it("decodes Docker multiplexed stdout/stderr frames and timestamp prefixes", () => {
    const body = Buffer.concat([
      dockerFrame(1, "2026-08-15T12:59:58.123456789Z ready\n"),
      dockerFrame(2, "2026-08-15T12:59:59.900000000Z warning\n"),
    ]);
    expect(parseDockerLogBody(body)).toEqual({
      entries: [
        {
          sequence: 0,
          timestamp: "2026-08-15T12:59:58.123Z",
          level: "UNKNOWN",
          stream: "STDOUT",
          message: "ready",
        },
        {
          sequence: 1,
          timestamp: "2026-08-15T12:59:59.900Z",
          level: "UNKNOWN",
          stream: "STDERR",
          message: "warning",
        },
      ],
      truncated: false,
    });
  });

  it("supports plain Docker/TTY output without inventing a stream or level", () => {
    expect(
      parseDockerLogBody(
        Buffer.from("2026-08-15T12:59:58.000000000Z terminal output\n", "utf8"),
      ).entries,
    ).toEqual([
      {
        sequence: 0,
        timestamp: "2026-08-15T12:59:58.000Z",
        level: "UNKNOWN",
        stream: "COMBINED",
        message: "terminal output",
      },
    ]);
  });

  it("rejects malformed Docker raw-stream frames", () => {
    const header = Buffer.alloc(8);
    header[0] = 1;
    header.writeUInt32BE(100, 4);
    expect(() => parseDockerLogBody(Buffer.concat([header, Buffer.from("short")]))).toThrow(
      LogSourceUnavailableError,
    );
  });

  it("normalizes journal priority and microsecond timestamp evidence", () => {
    const micros = String(Date.parse("2026-08-15T12:59:00.000Z") * 1_000);
    const parsed = parseJournalJsonLines(
      `${JSON.stringify({ __REALTIME_TIMESTAMP: micros, PRIORITY: "4", MESSAGE: "voltage warning" })}\n`,
    );
    expect(parsed).toEqual({
      entries: [
        {
          sequence: 0,
          timestamp: "2026-08-15T12:59:00.000Z",
          level: "WARN",
          stream: "JOURNAL",
          message: "voltage warning",
        },
      ],
      truncated: false,
    });
  });

  it("keeps untimestamped file lines honest and drops a partial tail prefix", () => {
    const parsed = parseFileTail(
      "partial prefix\n2026-08-15T12:59:00Z backup complete\nplain legacy line\n",
      true,
    );
    expect(parsed).toEqual({
      entries: [
        {
          sequence: 0,
          timestamp: "2026-08-15T12:59:00.000Z",
          level: "UNKNOWN",
          stream: "FILE",
          message: "backup complete",
        },
        {
          sequence: 1,
          timestamp: null,
          level: "UNKNOWN",
          stream: "FILE",
          message: "plain legacy line",
        },
      ],
      truncated: true,
    });
  });
});

describe("readLogSnapshot", () => {
  it("uses fixed Docker registration and server-derived range", async () => {
    const readDockerLogs = vi.fn(async () =>
      Buffer.from("2026-08-15T12:59:00Z hello\n", "utf8"),
    );
    const result = await readLogSnapshot(
      "docker:homeassistant",
      "1h",
      dependencies({ readDockerLogs }),
    );

    expect(readDockerLogs).toHaveBeenCalledWith(
      "homeassistant",
      Math.floor(Date.parse("2026-08-15T13:00:00.000Z") / 1_000) - 3_600,
      undefined,
    );
    expect(result.source.sourceId).toBe("docker:homeassistant");
    expect(result.rangeApplied).toBe(true);
    expect(result.entries).toHaveLength(1);
  });

  it("uses fixed journalctl executable and registered argv", async () => {
    const execFile = vi.fn(async () => ({ stdout: "" }));
    const result = await readLogSnapshot(
      "systemd:ssh",
      "6h",
      dependencies({ execFile }),
    );

    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0]?.[0]).toBe(JOURNALCTL_PATH);
    expect(execFile.mock.calls[0]?.[1]).toContain("--unit=ssh.service");
    expect(execFile.mock.calls[0]?.[1]).toContain("--since=-6h");
    expect(execFile.mock.calls[0]?.[2]).toMatchObject({ shell: false });
    expect(result.rangeApplied).toBe(true);
  });

  it("reads only the registered backup path and marks range as tail-only", async () => {
    const readFileTail = vi.fn(async () => ({ text: "legacy line\n", truncated: false }));
    const result = await readLogSnapshot(
      "file:rpi5-backup",
      "24h",
      dependencies({ readFileTail }),
    );

    expect(readFileTail.mock.calls[0]?.[0]).toBe("/var/log/rpi5-backup.log");
    expect(result.rangeApplied).toBe(false);
    expect(result.entries[0]?.timestamp).toBeNull();
  });

  it("normalizes backend failures to one source-unavailable error", async () => {
    await expect(
      readLogSnapshot(
        "systemd:cron",
        "1h",
        dependencies({
          execFile: async () => {
            throw new Error("sensitive backend detail");
          },
        }),
      ),
    ).rejects.toBeInstanceOf(LogSourceUnavailableError);
  });
});
