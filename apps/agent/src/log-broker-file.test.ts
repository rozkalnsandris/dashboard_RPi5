import { constants } from "node:fs";
import { chmod, mkdtemp, open as nodeOpen, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  readDescriptorSafeFileTail,
  RPI5_BACKUP_LOG_PATH,
  type DescriptorFileHandle,
  type FileMetadataContract,
} from "./log-broker-file.js";
import { readBrokerLogSnapshot } from "./log-broker-reader.js";
import { LOG_FILE_TAIL_BYTES, LogSourceUnavailableError } from "./logs-read.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "dashboard-rpi5-log-broker-file-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function createReviewedTestFile(path: string, content: string): Promise<FileMetadataContract> {
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
  const metadata = await stat(path);
  return { uid: metadata.uid, gid: metadata.gid, mode: 0o600 };
}

describe("descriptor-safe privileged file tail", () => {
  it("opens with O_NOFOLLOW, validates metadata, and returns only the bounded tail", async () => {
    const root = await tempRoot();
    const path = resolve(root, "backup.log");
    const contract = await createReviewedTestFile(path, "0123456789");
    let observedFlags = 0;

    const result = await readDescriptorSafeFileTail(path, 4, contract, undefined, {
      openFile: async (fixedPath, flags) => {
        observedFlags = flags;
        return nodeOpen(fixedPath, flags);
      },
    });

    expect(RPI5_BACKUP_LOG_PATH).toBe("/var/log/rpi5-backup.log");
    expect(observedFlags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
    expect(result).toEqual({ text: "6789", truncated: true });
  });

  it("rejects a final-component symlink and a non-regular file", async () => {
    const root = await tempRoot();
    const target = resolve(root, "target.log");
    const link = resolve(root, "backup.log");
    const contract = await createReviewedTestFile(target, "safe\n");
    await symlink(target, link);

    await expect(readDescriptorSafeFileTail(link, 64, contract)).rejects.toBeInstanceOf(
      LogSourceUnavailableError,
    );
    await expect(readDescriptorSafeFileTail(root, 64, contract)).rejects.toBeInstanceOf(
      LogSourceUnavailableError,
    );
  });

  it("rejects unsafe metadata instead of chmodding or accepting it", async () => {
    const root = await tempRoot();
    const path = resolve(root, "backup.log");
    const contract = await createReviewedTestFile(path, "safe\n");
    await chmod(path, 0o640);

    await expect(readDescriptorSafeFileTail(path, 64, contract)).rejects.toBeInstanceOf(
      LogSourceUnavailableError,
    );
    expect((await stat(path)).mode & 0o777).toBe(0o640);
  });

  it("continues reading the already-opened object after pathname replacement", async () => {
    const root = await tempRoot();
    const path = resolve(root, "backup.log");
    const moved = resolve(root, "opened.log");
    const contract = await createReviewedTestFile(path, "original\n");

    const result = await readDescriptorSafeFileTail(path, 64, contract, undefined, {
      openFile: async (fixedPath, flags) => {
        const handle = await nodeOpen(fixedPath, flags);
        await rename(path, moved);
        await writeFile(path, "replacement\n", { mode: 0o600 });
        await chmod(path, 0o600);
        return handle;
      },
    });

    expect(result).toEqual({ text: "original\n", truncated: false });
  });

  it("closes the descriptor when abort makes the read fail closed", async () => {
    const controller = new AbortController();
    let closed = false;
    const handle: DescriptorFileHandle = {
      stat: async () => ({
        size: 4,
        uid: 0,
        gid: 0,
        mode: 0o100600,
        isFile: () => true,
      }),
      read: async (buffer, offset, length) => {
        buffer.fill(0x78, offset, offset + length);
        controller.abort();
        return { bytesRead: length };
      },
      close: async () => {
        closed = true;
      },
    };

    await expect(
      readDescriptorSafeFileTail(
        "/fixed/test.log",
        4,
        { uid: 0, gid: 0, mode: 0o600 },
        controller.signal,
        { openFile: async () => handle },
      ),
    ).rejects.toThrow();
    expect(closed).toBe(true);
  });
});

describe("privileged log broker file source routing", () => {
  it("keeps browser authority at the registered source ID and uses the fixed backup reader", async () => {
    let requestedMaxBytes = 0;
    const result = await readBrokerLogSnapshot("file:rpi5-backup", "24h", {
      now: () => new Date("2026-08-30T12:00:00.000Z"),
      execFile: async () => {
        throw new Error("file source must not execute a command");
      },
      readRegistered: async () => {
        throw new Error("file source must not use the generic pathname reader");
      },
      readBackupFileTail: async (maxBytes) => {
        requestedMaxBytes = maxBytes;
        return { text: "2026-08-30T11:59:00Z backup complete\n", truncated: false };
      },
    });

    expect(requestedMaxBytes).toBe(LOG_FILE_TAIL_BYTES);
    expect(result.source.sourceId).toBe("file:rpi5-backup");
    expect(result.rangeApplied).toBe(false);
    expect(result.entries[0]?.message).toBe("backup complete");
  });
});
