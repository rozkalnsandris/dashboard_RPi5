import {
  BACKUP_EVIDENCE_MAX_RUNS,
  parseBackupEvidenceFile,
  type BackupEvidenceSnapshot,
} from "@dashboard-rpi5/contracts/backups";
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";

export const DEFAULT_BACKUP_EVIDENCE_PATH = "/var/lib/dashboard-rpi5/evidence/backups.json";
export const DEFAULT_BACKUP_EVIDENCE_MAX_BYTES = 64 * 1024;

interface BackupEvidenceReadOptions {
  path?: string;
  maxBytes?: number;
  requiredUid?: number;
  now?: () => Date;
}

export class BackupSourceUnavailableError extends Error {
  constructor() {
    super("Backup evidence source unavailable");
    this.name = "BackupSourceUnavailableError";
  }
}

function validatePath(path: string): string {
  if (!isAbsolute(path) || path.includes("\0") || Buffer.byteLength(path, "utf8") > 256) {
    throw new TypeError("Invalid backup evidence path");
  }
  return path;
}

function validateMaxBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_024 || value > 256 * 1024) {
    throw new RangeError("Backup evidence maxBytes outside allowed range");
  }
  return value;
}

function validateUid(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Backup evidence uid outside allowed range");
  }
  return value;
}

async function readBoundedFile(
  handle: Awaited<ReturnType<typeof open>>,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;

  while (true) {
    if (signal.aborted) throw new BackupSourceUnavailableError();
    const remaining = maxBytes + 1 - total;
    if (remaining <= 0) throw new BackupSourceUnavailableError();
    const buffer = Buffer.allocUnsafe(Math.min(8 * 1024, remaining));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maxBytes) throw new BackupSourceUnavailableError();
    chunks.push(buffer.subarray(0, bytesRead));
  }

  return Buffer.concat(chunks).toString("utf8");
}

export async function readBackupEvidence(
  options: BackupEvidenceReadOptions = {},
  signal: AbortSignal = new AbortController().signal,
): Promise<BackupEvidenceSnapshot> {
  const path = validatePath(options.path ?? DEFAULT_BACKUP_EVIDENCE_PATH);
  const maxBytes = validateMaxBytes(options.maxBytes ?? DEFAULT_BACKUP_EVIDENCE_MAX_BYTES);
  const requiredUid = validateUid(options.requiredUid ?? 0);
  const now = options.now ?? (() => new Date());
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    if (signal.aborted) throw new BackupSourceUnavailableError();
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== requiredUid ||
      (metadata.mode & 0o022) !== 0 ||
      metadata.size > maxBytes
    ) {
      throw new BackupSourceUnavailableError();
    }

    const raw = await readBoundedFile(handle, maxBytes, signal);
    const parsed = parseBackupEvidenceFile(JSON.parse(raw) as unknown);
    if (parsed.runs.length > BACKUP_EVIDENCE_MAX_RUNS) {
      throw new BackupSourceUnavailableError();
    }

    return {
      observedAt: now().toISOString(),
      schema: parsed.schema,
      runs: parsed.runs,
    };
  } catch (error) {
    if (error instanceof BackupSourceUnavailableError) throw error;
    throw new BackupSourceUnavailableError();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
