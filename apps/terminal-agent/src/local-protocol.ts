import { TextDecoder } from "node:util";

import {
  TERMINAL_NATIVE_MAX_COLS,
  TERMINAL_NATIVE_MAX_ROWS,
  TERMINAL_NATIVE_MIN_COLS,
  TERMINAL_NATIVE_MIN_ROWS,
} from "./native-pty.js";

export const TERMINAL_LOCAL_PROTOCOL_VERSION = 1 as const;
export const TERMINAL_LOCAL_MAX_FRAME_BYTES = 4096;
export const TERMINAL_LOCAL_MAX_INPUT_BYTES = 2048;
export const TERMINAL_LOCAL_MAX_OUTPUT_EVENT_BYTES = 64 * 1024;
export const TERMINAL_LOCAL_MAX_OUTPUT_CHUNK_BYTES = 4096;
export const TERMINAL_LOCAL_MAX_PENDING_OUTPUT_BYTES = 64 * 1024;
export const TERMINAL_LOCAL_OPEN_TIMEOUT_MS = 5_000;
export const TERMINAL_LOCAL_IDLE_TIMEOUT_MS = 5 * 60_000;
export const TERMINAL_LOCAL_ABSOLUTE_TIMEOUT_MS = 30 * 60_000;

export type TerminalLocalClientFrame =
  | { v: 1; type: "open"; cols: number; rows: number }
  | { v: 1; type: "input"; data: string }
  | { v: 1; type: "resize"; cols: number; rows: number }
  | { v: 1; type: "close" };

export type TerminalLocalErrorCode =
  | "PROTOCOL_ERROR"
  | "PTY_UNAVAILABLE"
  | "SESSION_EXPIRED"
  | "OUTPUT_OVERFLOW";

export type TerminalLocalServerFrame =
  | { v: 1; type: "ready" }
  | { v: 1; type: "output"; data: string }
  | { v: 1; type: "exit"; code: number | null; signal: number | null }
  | { v: 1; type: "error"; code: TerminalLocalErrorCode };

export class TerminalLocalProtocolError extends Error {
  constructor() {
    super("Terminal local protocol frame is invalid");
    this.name = "TerminalLocalProtocolError";
  }
}

const fatalUtf8 = new TextDecoder("utf-8", { fatal: true });

export function parseTerminalLocalClientFrame(bytes: Uint8Array): TerminalLocalClientFrame {
  if (bytes.byteLength === 0 || bytes.byteLength > TERMINAL_LOCAL_MAX_FRAME_BYTES) {
    throw new TerminalLocalProtocolError();
  }

  let text: string;
  try {
    text = fatalUtf8.decode(bytes);
  } catch {
    throw new TerminalLocalProtocolError();
  }

  if (text.includes("\0") || text.endsWith("\r")) {
    throw new TerminalLocalProtocolError();
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new TerminalLocalProtocolError();
  }

  if (!isRecord(value) || value.v !== TERMINAL_LOCAL_PROTOCOL_VERSION || typeof value.type !== "string") {
    throw new TerminalLocalProtocolError();
  }

  switch (value.type) {
    case "open":
      assertExactKeys(value, ["v", "type", "cols", "rows"]);
      assertDimensions(value.cols, value.rows);
      return { v: 1, type: "open", cols: value.cols, rows: value.rows };
    case "input":
      assertExactKeys(value, ["v", "type", "data"]);
      if (
        typeof value.data !== "string" ||
        value.data.length === 0 ||
        value.data.includes("\0") ||
        Buffer.byteLength(value.data, "utf8") > TERMINAL_LOCAL_MAX_INPUT_BYTES
      ) {
        throw new TerminalLocalProtocolError();
      }
      return { v: 1, type: "input", data: value.data };
    case "resize":
      assertExactKeys(value, ["v", "type", "cols", "rows"]);
      assertDimensions(value.cols, value.rows);
      return { v: 1, type: "resize", cols: value.cols, rows: value.rows };
    case "close":
      assertExactKeys(value, ["v", "type"]);
      return { v: 1, type: "close" };
    default:
      throw new TerminalLocalProtocolError();
  }
}

export function serializeTerminalLocalServerFrame(frame: TerminalLocalServerFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

export function splitTerminalLocalOutput(data: string): string[] {
  const totalBytes = Buffer.byteLength(data, "utf8");
  if (totalBytes > TERMINAL_LOCAL_MAX_OUTPUT_EVENT_BYTES) {
    throw new TerminalLocalProtocolError();
  }
  if (data.length === 0) return [];

  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const symbol of data) {
    const symbolBytes = Buffer.byteLength(symbol, "utf8");
    if (currentBytes > 0 && currentBytes + symbolBytes > TERMINAL_LOCAL_MAX_OUTPUT_CHUNK_BYTES) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += symbol;
    currentBytes += symbolBytes;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

export class TerminalLocalLineDecoder {
  #pending = Buffer.alloc(0);

  push(chunk: Uint8Array): Uint8Array[] {
    if (chunk.byteLength === 0) return [];
    const combined = Buffer.concat([this.#pending, Buffer.from(chunk)]);
    const frames: Uint8Array[] = [];
    let start = 0;

    for (let index = 0; index < combined.length; index += 1) {
      if (combined[index] !== 0x0a) continue;
      const length = index - start;
      if (length === 0 || length > TERMINAL_LOCAL_MAX_FRAME_BYTES) {
        throw new TerminalLocalProtocolError();
      }
      frames.push(combined.subarray(start, index));
      start = index + 1;
    }

    this.#pending = combined.subarray(start);
    if (this.#pending.length > TERMINAL_LOCAL_MAX_FRAME_BYTES) {
      throw new TerminalLocalProtocolError();
    }
    return frames;
  }

  end(): void {
    if (this.#pending.length !== 0) {
      throw new TerminalLocalProtocolError();
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new TerminalLocalProtocolError();
  }
}

function assertDimensions(cols: unknown, rows: unknown): asserts cols is number & typeof rows {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    (cols as number) < TERMINAL_NATIVE_MIN_COLS ||
    (cols as number) > TERMINAL_NATIVE_MAX_COLS ||
    (rows as number) < TERMINAL_NATIVE_MIN_ROWS ||
    (rows as number) > TERMINAL_NATIVE_MAX_ROWS
  ) {
    throw new TerminalLocalProtocolError();
  }
}
