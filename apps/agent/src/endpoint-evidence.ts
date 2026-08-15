import {
  ENDPOINT_EVIDENCE_MAX_EVENTS,
  parseEndpointEvidenceFile,
  type EndpointEvidenceSnapshot,
} from "@dashboard-rpi5/contracts/endpoints";
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";

export const DEFAULT_ENDPOINT_EVIDENCE_PATH = "/var/lib/dashboard-rpi5/evidence/endpoints.json";
export const DEFAULT_ENDPOINT_EVIDENCE_MAX_BYTES = 64 * 1024;

interface EndpointEvidenceReadOptions {
  path?: string;
  maxBytes?: number;
  requiredUid?: number;
  now?: () => Date;
}

export class EndpointSourceUnavailableError extends Error {
  constructor() {
    super("Endpoint evidence source unavailable");
    this.name = "EndpointSourceUnavailableError";
  }
}

function validatePath(path: string): string {
  if (!isAbsolute(path) || path.includes("\0") || Buffer.byteLength(path, "utf8") > 256) {
    throw new TypeError("Invalid endpoint evidence path");
  }
  return path;
}

function validateMaxBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_024 || value > 256 * 1024) {
    throw new RangeError("Endpoint evidence maxBytes outside allowed range");
  }
  return value;
}

function validateUid(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Endpoint evidence uid outside allowed range");
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
    if (signal.aborted) throw new EndpointSourceUnavailableError();
    const remaining = maxBytes + 1 - total;
    if (remaining <= 0) throw new EndpointSourceUnavailableError();
    const buffer = Buffer.allocUnsafe(Math.min(8 * 1024, remaining));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maxBytes) throw new EndpointSourceUnavailableError();
    chunks.push(buffer.subarray(0, bytesRead));
  }

  return Buffer.concat(chunks).toString("utf8");
}

export async function readEndpointEvidence(
  options: EndpointEvidenceReadOptions = {},
  signal: AbortSignal = new AbortController().signal,
): Promise<EndpointEvidenceSnapshot> {
  const path = validatePath(options.path ?? DEFAULT_ENDPOINT_EVIDENCE_PATH);
  const maxBytes = validateMaxBytes(options.maxBytes ?? DEFAULT_ENDPOINT_EVIDENCE_MAX_BYTES);
  const requiredUid = validateUid(options.requiredUid ?? 0);
  const now = options.now ?? (() => new Date());
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    if (signal.aborted) throw new EndpointSourceUnavailableError();
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== requiredUid ||
      (metadata.mode & 0o022) !== 0 ||
      metadata.size > maxBytes
    ) {
      throw new EndpointSourceUnavailableError();
    }

    const raw = await readBoundedFile(handle, maxBytes, signal);
    const parsed = parseEndpointEvidenceFile(JSON.parse(raw) as unknown);
    if (parsed.events.length > ENDPOINT_EVIDENCE_MAX_EVENTS) {
      throw new EndpointSourceUnavailableError();
    }

    const observedAt = now();
    if (!Number.isFinite(observedAt.getTime())) throw new EndpointSourceUnavailableError();

    return {
      observedAt: observedAt.toISOString(),
      schema: parsed.schema,
      events: parsed.events,
    };
  } catch (error) {
    if (error instanceof EndpointSourceUnavailableError) throw error;
    throw new EndpointSourceUnavailableError();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
