import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  BackupSourceUnavailableError,
  readBackupEvidence,
} from "./backup-evidence.js";

const directories: string[] = [];
const currentUid = process.getuid?.() ?? 0;

async function makeDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-backup-evidence-"));
  directories.push(directory);
  return directory;
}

async function writeEvidence(directory: string, value: unknown, mode = 0o600) {
  const path = join(directory, "backups.json");
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
  await chmod(path, mode);
  return path;
}

const validEvidence = {
  schema: "dashboard-rpi5.backup-evidence.v1",
  runs: [
    {
      runId: "20260814T020000+0200",
      startedAt: "2026-08-14T02:00:00+02:00",
      completedAt: "2026-08-14T02:02:00+02:00",
      result: "SUCCESS",
      durationSeconds: 120,
      sizeBytes: 123_456,
      exitCode: 0,
    },
    {
      runId: "20260815T020000+0200",
      startedAt: "2026-08-15T02:00:00+02:00",
      completedAt: "2026-08-15T02:01:00+02:00",
      result: "FAILED",
      durationSeconds: 60,
      sizeBytes: null,
      exitCode: 23,
    },
  ],
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Phase 5C-B structured backup evidence reader", () => {
  it("reads only a safe regular file and normalizes runs newest-first", async () => {
    const directory = await makeDirectory();
    const path = await writeEvidence(directory, validEvidence);

    await expect(
      readBackupEvidence(
        {
          path,
          requiredUid: currentUid,
          now: () => new Date("2026-08-15T18:00:00.000Z"),
        },
      ),
    ).resolves.toEqual({
      observedAt: "2026-08-15T18:00:00.000Z",
      schema: "dashboard-rpi5.backup-evidence.v1",
      runs: [validEvidence.runs[1], validEvidence.runs[0]],
    });
  });

  it("fails closed for missing, non-regular, wrong-owner, symlink and writable evidence", async () => {
    const directory = await makeDirectory();
    const missing = join(directory, "missing.json");
    await expect(
      readBackupEvidence({ path: missing, requiredUid: currentUid }),
    ).rejects.toBeInstanceOf(BackupSourceUnavailableError);

    await expect(
      readBackupEvidence({ path: directory, requiredUid: currentUid }),
    ).rejects.toBeInstanceOf(BackupSourceUnavailableError);

    const target = await writeEvidence(directory, validEvidence);
    await expect(
      readBackupEvidence({ path: target, requiredUid: currentUid + 1 }),
    ).rejects.toBeInstanceOf(BackupSourceUnavailableError);

    const link = join(directory, "link.json");
    await symlink(target, link);
    await expect(
      readBackupEvidence({ path: link, requiredUid: currentUid }),
    ).rejects.toBeInstanceOf(BackupSourceUnavailableError);

    await chmod(target, 0o660);
    await expect(
      readBackupEvidence({ path: target, requiredUid: currentUid }),
    ).rejects.toBeInstanceOf(BackupSourceUnavailableError);
  });

  it("rejects oversized and malformed structured evidence without log or mtime fallback", async () => {
    const directory = await makeDirectory();
    const oversized = join(directory, "oversized.json");
    await writeFile(oversized, `{"schema":"dashboard-rpi5.backup-evidence.v1","runs":[],"pad":"${"x".repeat(2_000)}"}`, { mode: 0o600 });
    await expect(
      readBackupEvidence({ path: oversized, requiredUid: currentUid, maxBytes: 1_024 }),
    ).rejects.toBeInstanceOf(BackupSourceUnavailableError);

    const malformed = await writeEvidence(directory, { ...validEvidence, privatePath: "/etc/shadow" });
    await expect(
      readBackupEvidence({ path: malformed, requiredUid: currentUid }),
    ).rejects.toBeInstanceOf(BackupSourceUnavailableError);
  });

  it("rejects ambiguous timestamps and inconsistent result evidence", async () => {
    const cases = [
      {
        ...validEvidence,
        runs: [{ ...validEvidence.runs[0], startedAt: "2026-08-14T02:00:00" }],
      },
      {
        ...validEvidence,
        runs: [{ ...validEvidence.runs[0], completedAt: "2026-08-14T01:59:00+02:00" }],
      },
      {
        ...validEvidence,
        runs: [{ ...validEvidence.runs[0], durationSeconds: 42 }],
      },
      {
        ...validEvidence,
        runs: [{ ...validEvidence.runs[0], result: "SUCCESS", exitCode: 1 }],
      },
      {
        ...validEvidence,
        runs: [{ ...validEvidence.runs[1], result: "FAILED", exitCode: 0 }],
      },
    ];

    for (const value of cases) {
      const directory = await makeDirectory();
      const path = await writeEvidence(directory, value);
      await expect(
        readBackupEvidence({ path, requiredUid: currentUid }),
      ).rejects.toBeInstanceOf(BackupSourceUnavailableError);
    }
  });

  it("enforces the bounded history size", async () => {
    const directory = await makeDirectory();
    const runs = Array.from({ length: 33 }, (_, index) => ({
      ...validEvidence.runs[0],
      runId: `run-${index}`,
    }));
    const path = await writeEvidence(directory, { ...validEvidence, runs });
    await expect(
      readBackupEvidence({ path, requiredUid: currentUid }),
    ).rejects.toBeInstanceOf(BackupSourceUnavailableError);
  });
});
