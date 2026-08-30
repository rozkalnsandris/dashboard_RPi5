import { constants } from "node:fs";
import { open } from "node:fs/promises";

import { LogSourceUnavailableError } from "./logs-read.js";

export const RPI5_BACKUP_LOG_PATH = "/var/log/rpi5-backup.log";
export const RPI5_BACKUP_LOG_UID = 0;
export const RPI5_BACKUP_LOG_GID = 0;
export const RPI5_BACKUP_LOG_MODE = 0o600;

export interface DescriptorSafeFileTailResult {
  text: string;
  truncated: boolean;
}

export interface FileMetadataContract {
  uid: number;
  gid: number;
  mode: number;
}

const backupLogMetadataContract: FileMetadataContract = Object.freeze({
  uid: RPI5_BACKUP_LOG_UID,
  gid: RPI5_BACKUP_LOG_GID,
  mode: RPI5_BACKUP_LOG_MODE,
});

export async function readDescriptorSafeFileTail(
  path: string,
  maxBytes: number,
  metadataContract: FileMetadataContract,
  signal?: AbortSignal,
): Promise<DescriptorSafeFileTailResult> {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new LogSourceUnavailableError();
  if (typeof constants.O_NOFOLLOW !== "number") throw new LogSourceUnavailableError();

  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size < 0 ||
      metadata.uid !== metadataContract.uid ||
      metadata.gid !== metadataContract.gid ||
      (metadata.mode & 0o777) !== metadataContract.mode
    ) {
      throw new LogSourceUnavailableError();
    }

    const start = Math.max(0, metadata.size - maxBytes);
    const expectedBytes = metadata.size - start;
    const buffer = Buffer.alloc(expectedBytes);
    let total = 0;
    while (total < expectedBytes) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, total, expectedBytes - total, start + total);
      if (bytesRead <= 0) throw new LogSourceUnavailableError();
      total += bytesRead;
    }
    signal?.throwIfAborted();
    return { text: buffer.toString("utf8"), truncated: start > 0 };
  } catch (error: unknown) {
    if (error instanceof LogSourceUnavailableError) throw error;
    throw new LogSourceUnavailableError();
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // Closing a read-only descriptor must not replace an already-determined
        // source result, but the descriptor is never intentionally retained.
      }
    }
  }
}

export function readProductionBackupLogTail(
  maxBytes: number,
  signal?: AbortSignal,
): Promise<DescriptorSafeFileTailResult> {
  return readDescriptorSafeFileTail(
    RPI5_BACKUP_LOG_PATH,
    maxBytes,
    backupLogMetadataContract,
    signal,
  );
}
