import { describe, expect, it } from "vitest";

import {
  JOURNALCTL_PATH,
  MAINTENANCE_FAILURE_MESSAGE_ID,
  MAINTENANCE_JOURNAL_MAX_BYTES,
  MAINTENANCE_SUCCESS_MESSAGE_ID,
  MAINTENANCE_UNIT,
  MaintenanceSourceUnavailableError,
  buildMaintenanceJournalctlArgs,
  parseMaintenanceJournalJsonLines,
  readRecentMaintenanceEvents,
} from "./maintenance-events.js";

const invocationSuccess = "0123456789abcdef0123456789abcdef";
const invocationFailed = "fedcba9876543210fedcba9876543210";

function journalLine(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

const successRecord = {
  __REALTIME_TIMESTAMP: "1786818600123456",
  MESSAGE_ID: MAINTENANCE_SUCCESS_MESSAGE_ID,
  UNIT: MAINTENANCE_UNIT,
  INVOCATION_ID: invocationSuccess,
};

const failedRecord = {
  __REALTIME_TIMESTAMP: "1786818500123456",
  MESSAGE_ID: MAINTENANCE_FAILURE_MESSAGE_ID,
  UNIT: MAINTENANCE_UNIT,
  INVOCATION_ID: invocationFailed,
  UNIT_RESULT: "exit-code",
};

describe("Phase 5C-C structured maintenance journal reader", () => {
  it("uses fixed journalctl argv with no browser-controlled selector", () => {
    expect(buildMaintenanceJournalctlArgs()).toEqual([
      "--no-pager",
      "--output=json",
      "--output-fields=__REALTIME_TIMESTAMP,MESSAGE_ID,UNIT,INVOCATION_ID,UNIT_RESULT",
      "--since=-7d",
      "--lines=64",
      "UNIT=rpi5-update.service",
      "_PID=1",
      `MESSAGE_ID=${MAINTENANCE_SUCCESS_MESSAGE_ID}`,
      `MESSAGE_ID=${MAINTENANCE_FAILURE_MESSAGE_ID}`,
    ]);
  });

  it("normalizes success and failure from structured fields only, newest first", () => {
    const events = parseMaintenanceJournalJsonLines(
      `${journalLine(failedRecord)}\n${journalLine({ ...successRecord, MESSAGE: "ignored free text" })}\n`,
    );
    expect(events).toEqual([
      {
        invocationId: invocationSuccess,
        occurredAt: "2026-08-15T18:30:00.123Z",
        result: "SUCCESS",
        unitResult: null,
      },
      {
        invocationId: invocationFailed,
        occurredAt: "2026-08-15T18:28:20.123Z",
        result: "FAILED",
        unitResult: "exit-code",
      },
    ]);
  });

  it("accepts an empty successful journal query as available empty history", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    await expect(
      readRecentMaintenanceEvents({
        async execFile(file, args) {
          calls.push({ file, args });
          return { stdout: "" };
        },
        now: () => new Date("2026-08-15T19:00:00.000Z"),
      }),
    ).resolves.toEqual({ observedAt: "2026-08-15T19:00:00.000Z", events: [] });
    expect(calls).toEqual([{ file: JOURNALCTL_PATH, args: buildMaintenanceJournalctlArgs() }]);
  });

  it("fails closed for malformed or mismatched structured evidence", () => {
    const cases: unknown[] = [
      "not json",
      JSON.stringify([]),
      journalLine({ ...successRecord, UNIT: "ssh.service" }),
      journalLine({ ...successRecord, MESSAGE_ID: "0".repeat(32) }),
      journalLine({ ...successRecord, INVOCATION_ID: "xyz" }),
      journalLine({ ...successRecord, __REALTIME_TIMESTAMP: "1.5" }),
      journalLine({ ...successRecord, UNIT_RESULT: "success" }),
      journalLine({ ...failedRecord, UNIT_RESULT: "bad result with spaces" }),
      journalLine({ ...failedRecord, UNIT_RESULT: "x".repeat(65) }),
      journalLine({ ...failedRecord, UNIT_RESULT: ["exit-code"] }),
    ];

    for (const value of cases) {
      const input = typeof value === "string" ? value : JSON.stringify(value);
      expect(() => parseMaintenanceJournalJsonLines(input)).toThrow(
        MaintenanceSourceUnavailableError,
      );
    }
  });

  it("deduplicates exact records and fails closed for oversized output or exec failure", async () => {
    expect(
      parseMaintenanceJournalJsonLines(`${journalLine(successRecord)}\n${journalLine(successRecord)}\n`),
    ).toHaveLength(1);

    expect(() =>
      parseMaintenanceJournalJsonLines("x".repeat(MAINTENANCE_JOURNAL_MAX_BYTES + 1)),
    ).toThrow(MaintenanceSourceUnavailableError);

    await expect(
      readRecentMaintenanceEvents({
        async execFile() {
          throw new Error("permission denied");
        },
        now: () => new Date(),
      }),
    ).rejects.toBeInstanceOf(MaintenanceSourceUnavailableError);
  });
});
