import { describe, expect, it } from "vitest";

import {
  LogSourceUnavailableError,
  readLogSnapshot,
  type LogReadDependencies,
} from "./logs-read.js";

function dependencies(stdout: string): LogReadDependencies {
  return {
    now: () => new Date("2026-08-15T20:00:00.000Z"),
    execFile: async () => ({ stdout }),
    readFileTail: async () => ({ text: "", truncated: false }),
    readDockerLogs: async () => Buffer.alloc(0),
  };
}

const micros = String(Date.parse("2026-08-15T19:59:00.000Z") * 1_000);

function line(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    __REALTIME_TIMESTAMP: micros,
    PRIORITY: "6",
    MESSAGE: "DEPLOY PASS transaction=20260815T195900000000Z-abcdef123456 commit=abcdef123456",
    _UID: "0",
    _TRANSPORT: "syslog",
    SYSLOG_IDENTIFIER: "rpi5-deploy",
    ...overrides,
  });
}

describe("registered deploy log origin", () => {
  it("accepts only the fixed root/syslog/rpi5-deploy origin", async () => {
    const snapshot = await readLogSnapshot(
      "journal:rpi5-deploy",
      "1h",
      dependencies(`${line()}\n`),
    );
    expect(snapshot.entries[0]).toMatchObject({
      timestamp: "2026-08-15T19:59:00.000Z",
      stream: "JOURNAL",
    });
  });

  it("fails closed if returned journal records drift from the registered origin", async () => {
    for (const overrides of [
      { _UID: "1000" },
      { _TRANSPORT: "journal" },
      { SYSLOG_IDENTIFIER: "spoofed" },
    ]) {
      await expect(
        readLogSnapshot(
          "journal:rpi5-deploy",
          "1h",
          dependencies(`${line(overrides)}\n`),
        ),
      ).rejects.toBeInstanceOf(LogSourceUnavailableError);
    }
  });
});
