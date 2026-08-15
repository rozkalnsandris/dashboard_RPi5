import { describe, expect, it } from "vitest";

import {
  DEPLOY_JOURNAL_MAX_BYTES,
  DEPLOY_SYSLOG_IDENTIFIER,
  DeploySourceUnavailableError,
  JOURNALCTL_PATH,
  buildDeployJournalctlArgs,
  parseDeployJournalJsonLines,
  readRecentDeployEvents,
} from "./deploy-events.js";

const commit = "abcdef123456";
const transactionId = `20260815T195043123456Z-${commit}`;
const micros = String(Date.parse("2026-08-15T19:51:00.123Z") * 1_000);

function record(message: string, overrides: Record<string, unknown> = {}) {
  return {
    __REALTIME_TIMESTAMP: micros,
    _UID: "0",
    _TRANSPORT: "syslog",
    SYSLOG_IDENTIFIER: DEPLOY_SYSLOG_IDENTIFIER,
    MESSAGE: message,
    ...overrides,
  };
}

describe("Phase 5C-D verified deploy journal reader", () => {
  it("uses a fixed root/syslog/tag journal query", () => {
    expect(buildDeployJournalctlArgs()).toEqual([
      "--no-pager",
      "--output=json",
      "--output-fields=__REALTIME_TIMESTAMP,_UID,_TRANSPORT,SYSLOG_IDENTIFIER,MESSAGE",
      "--since=-7d",
      "--lines=64",
      "_UID=0",
      "_TRANSPORT=syslog",
      "SYSLOG_IDENTIFIER=rpi5-deploy",
    ]);
  });

  it("accepts only exact verified PASS markers and ignores other V12 markers", () => {
    const stdout = [
      record("PLAN PASS commit=abcdef123456"),
      record("DEPLOY FAIL transaction=bad; automatic rollback starting"),
      record(`DEPLOY PASS transaction=${transactionId} commit=${commit}`),
    ]
      .map((value) => JSON.stringify(value))
      .join("\n");

    expect(parseDeployJournalJsonLines(stdout)).toEqual([
      {
        transactionId,
        commit,
        occurredAt: "2026-08-15T19:51:00.123Z",
      },
    ]);
  });

  it("fails closed on malformed claimed PASS, commit mismatch or origin drift", () => {
    const cases = [
      record("DEPLOY PASS nope"),
      record(`DEPLOY PASS transaction=${transactionId} commit=111111111111`),
      record(`DEPLOY PASS transaction=${transactionId} commit=${commit}`, { _UID: "1000" }),
      record(`DEPLOY PASS transaction=${transactionId} commit=${commit}`, { _TRANSPORT: "journal" }),
      record(`DEPLOY PASS transaction=${transactionId} commit=${commit}`, {
        SYSLOG_IDENTIFIER: "other",
      }),
      record(`DEPLOY PASS transaction=${transactionId} commit=${commit}`, {
        __REALTIME_TIMESTAMP: "1.5",
      }),
    ];

    for (const value of cases) {
      expect(() => parseDeployJournalJsonLines(JSON.stringify(value))).toThrow(
        DeploySourceUnavailableError,
      );
    }
  });

  it("dedupes identical transaction evidence but rejects conflicting duplicates", () => {
    const valid = record(`DEPLOY PASS transaction=${transactionId} commit=${commit}`);
    expect(
      parseDeployJournalJsonLines(`${JSON.stringify(valid)}\n${JSON.stringify(valid)}\n`),
    ).toHaveLength(1);

    const conflicting = record(`DEPLOY PASS transaction=${transactionId} commit=${commit}`, {
      __REALTIME_TIMESTAMP: String(Date.parse("2026-08-15T19:52:00.000Z") * 1_000),
    });
    expect(() =>
      parseDeployJournalJsonLines(`${JSON.stringify(valid)}\n${JSON.stringify(conflicting)}\n`),
    ).toThrow(DeploySourceUnavailableError);
  });

  it("returns available empty history and wraps execution failures", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    await expect(
      readRecentDeployEvents({
        async execFile(file, args) {
          calls.push({ file, args });
          return { stdout: "" };
        },
        now: () => new Date("2026-08-15T20:00:00.000Z"),
      }),
    ).resolves.toEqual({ observedAt: "2026-08-15T20:00:00.000Z", events: [] });
    expect(calls).toEqual([{ file: JOURNALCTL_PATH, args: buildDeployJournalctlArgs() }]);

    await expect(
      readRecentDeployEvents({
        async execFile() {
          throw new Error("private journal detail");
        },
        now: () => new Date(),
      }),
    ).rejects.toBeInstanceOf(DeploySourceUnavailableError);
  });

  it("rejects oversized journal output", () => {
    expect(() => parseDeployJournalJsonLines("x".repeat(DEPLOY_JOURNAL_MAX_BYTES + 1))).toThrow(
      DeploySourceUnavailableError,
    );
  });
});
