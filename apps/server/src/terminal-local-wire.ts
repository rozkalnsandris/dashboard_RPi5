import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";

import {
  TERMINAL_DEFAULT_COLS,
  TERMINAL_DEFAULT_ROWS,
  TERMINAL_INPUT_MAX_BYTES,
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
} from "./terminal-application-protocol.js";

export const TERMINAL_LOCAL_PROTOCOL_VERSION = 1 as const;
export const TERMINAL_LOCAL_SERVER_FRAME_MAX_BYTES = 32 * 1024;
export const TERMINAL_LOCAL_READ_EVENT_MAX_BYTES = 64 * 1024;
export const TERMINAL_LOCAL_OUTPUT_CHUNK_MAX_BYTES = 4 * 1024;

export type TerminalLocalServerFrame =
  | { v: 1; type: "ready" }
  | { v: 1; type: "output"; data: string }
  | { v: 1; type: "exit"; code: number | null; signal: number | null }
  | {
      v: 1;
      type: "error";
      code: "PROTOCOL_ERROR" | "PTY_UNAVAILABLE" | "SESSION_EXPIRED" | "OUTPUT_OVERFLOW";
    };

export class TerminalLocalWireError extends Error {
  constructor() {
    super("Terminal local wire frame is invalid");
    this.name = "TerminalLocalWireError";
  }
}

const fatalUtf8 = new TextDecoder("utf-8", { fatal: true });
const LOCAL_ERROR_CODES = new Set([
  "PROTOCOL_ERROR",
  "PTY_UNAVAILABLE",
  "SESSION_EXPIRED",
  "OUTPUT_OVERFLOW",
]);

export function serializeTerminalLocalOpenFrame(): string {
  return serializeLocalClientFrame({
    v: TERMINAL_LOCAL_PROTOCOL_VERSION,
    type: "open",
    cols: TERMINAL_DEFAULT_COLS,
    rows: TERMINAL_DEFAULT_ROWS,
  });
}

export function serializeTerminalLocalInputFrame(data: string): string {
  if (
    data.length === 0 ||
    data.includes("\0") ||
    Buffer.byteLength(data, "utf8") > TERMINAL_INPUT_MAX_BYTES
  ) {
    throw new TerminalLocalWireError();
  }
  return serializeLocalClientFrame({ v: 1, type: "input", data });
}

export function serializeTerminalLocalResizeFrame(cols: number, rows: number): string {
  assertDimension(cols, TERMINAL_MIN_COLS, TERMINAL_MAX_COLS);
  assertDimension(rows, TERMINAL_MIN_ROWS, TERMINAL_MAX_ROWS);
  return serializeLocalClientFrame({ v: 1, type: "resize", cols, rows });
}

export function serializeTerminalLocalCloseFrame(): string {
  return serializeLocalClientFrame({ v: 1, type: "close" });
}

export class TerminalLocalServerLineDecoder {
  #pending = Buffer.alloc(0);

  push(chunk: Uint8Array): TerminalLocalServerFrame[] {
    if (chunk.byteLength === 0) return [];
    if (chunk.byteLength > TERMINAL_LOCAL_READ_EVENT_MAX_BYTES) {
      throw new TerminalLocalWireError();
    }

    const combined = Buffer.concat([this.#pending, Buffer.from(chunk)]);
    if (
      combined.byteLength >
      TERMINAL_LOCAL_READ_EVENT_MAX_BYTES + TERMINAL_LOCAL_SERVER_FRAME_MAX_BYTES
    ) {
      throw new TerminalLocalWireError();
    }

    const frames: TerminalLocalServerFrame[] = [];
    let start = 0;
    for (let index = 0; index < combined.length; index += 1) {
      if (combined[index] !== 0x0a) continue;
      const length = index - start;
      if (length === 0 || length > TERMINAL_LOCAL_SERVER_FRAME_MAX_BYTES) {
        throw new TerminalLocalWireError();
      }
      frames.push(parseTerminalLocalServerFrame(combined.subarray(start, index)));
      start = index + 1;
    }

    this.#pending = combined.subarray(start);
    if (this.#pending.byteLength > TERMINAL_LOCAL_SERVER_FRAME_MAX_BYTES) {
      throw new TerminalLocalWireError();
    }
    return frames;
  }

  end(): void {
    if (this.#pending.byteLength !== 0) {
      throw new TerminalLocalWireError();
    }
  }
}

export function parseTerminalLocalServerFrame(bytes: Uint8Array): TerminalLocalServerFrame {
  if (bytes.byteLength === 0 || bytes.byteLength > TERMINAL_LOCAL_SERVER_FRAME_MAX_BYTES) {
    throw new TerminalLocalWireError();
  }

  let value: unknown;
  try {
    value = JSON.parse(fatalUtf8.decode(bytes)) as unknown;
  } catch {
    throw new TerminalLocalWireError();
  }

  if (!isPlainRecord(value) || value.v !== 1 || typeof value.type !== "string") {
    throw new TerminalLocalWireError();
  }

  switch (value.type) {
    case "ready":
      assertExactKeys(value, ["v", "type"]);
      return { v: 1, type: "ready" };
    case "output":
      assertExactKeys(value, ["v", "type", "data"]);
      if (
        typeof value.data !== "string" ||
        value.data.length === 0 ||
        Buffer.byteLength(value.data, "utf8") > TERMINAL_LOCAL_OUTPUT_CHUNK_MAX_BYTES
      ) {
        throw new TerminalLocalWireError();
      }
      return { v: 1, type: "output", data: value.data };
    case "exit":
      assertExactKeys(value, ["v", "type", "code", "signal"]);
      if (!isNullableNonNegativeInteger(value.code) || !isNullableNonNegativeInteger(value.signal)) {
        throw new TerminalLocalWireError();
      }
      return { v: 1, type: "exit", code: value.code, signal: value.signal };
    case "error":
      assertExactKeys(value, ["v", "type", "code"]);
      if (typeof value.code !== "string" || !LOCAL_ERROR_CODES.has(value.code)) {
        throw new TerminalLocalWireError();
      }
      return {
        v: 1,
        type: "error",
        code: value.code as TerminalLocalServerFrame & never,
      } as TerminalLocalServerFrame;
    default:
      throw new TerminalLocalWireError();
  }
}

function serializeLocalClientFrame(value: object): string {
  const line = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(line, "utf8") > 4 * 1024) {
    throw new TerminalLocalWireError();
  }
  return line;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new TerminalLocalWireError();
  }
}

function assertDimension(value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TerminalLocalWireError();
  }
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}
