import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";

export interface RootOwnedEvidenceReadOptions {
  path: string;
  maxBytes?: number;
  requiredUid?: number;
}

export class RootOwnedEvidenceFileError extends Error {
  constructor() {
    super("Root-owned evidence file unavailable");
    this.name = "RootOwnedEvidenceFileError";
  }
}

function validatePath(path: string): string {
  if (!isAbsolute(path) || path.includes("\0") || Buffer.byteLength(path, "utf8") > 256) {
    throw new TypeError("Invalid evidence path");
  }
  return path;
}

function validateMaxBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_024 || value > 256 * 1024) {
    throw new RangeError("Evidence maxBytes outside allowed range");
  }
  return value;
}

function validateUid(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Evidence uid outside allowed range");
  }
  return value;
}

async function readBounded(
  handle: Awaited<ReturnType<typeof open>>,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;

  while (true) {
    signal?.throwIfAborted();
    const remaining = maxBytes + 1 - total;
    if (remaining <= 0) throw new RootOwnedEvidenceFileError();
    const buffer = Buffer.allocUnsafe(Math.min(8 * 1024, remaining));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maxBytes) throw new RootOwnedEvidenceFileError();
    chunks.push(buffer.subarray(0, bytesRead));
  }

  return Buffer.concat(chunks).toString("utf8");
}

export async function readRootOwnedEvidenceJson(
  options: RootOwnedEvidenceReadOptions,
  signal?: AbortSignal,
): Promise<unknown> {
  const path = validatePath(options.path);
  const maxBytes = validateMaxBytes(options.maxBytes ?? 64 * 1024);
  const requiredUid = validateUid(options.requiredUid ?? 0);
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    signal?.throwIfAborted();
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== requiredUid ||
      (metadata.mode & 0o022) !== 0 ||
      metadata.size > maxBytes
    ) {
      throw new RootOwnedEvidenceFileError();
    }

    const raw = await readBounded(handle, maxBytes, signal);
    signal?.throwIfAborted();
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if (error instanceof RootOwnedEvidenceFileError) throw error;
    throw new RootOwnedEvidenceFileError();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
