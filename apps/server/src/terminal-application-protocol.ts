import { Buffer } from "node:buffer";

export const TERMINAL_INPUT_MAX_BYTES = 2 * 1024;
export const TERMINAL_OUTPUT_FRAME_MAX_BYTES = 8 * 1024;
export const TERMINAL_OUTPUT_EVENT_MAX_BYTES = 64 * 1024;
export const TERMINAL_OUTPUT_BUFFER_MAX_BYTES = 64 * 1024;
export const TERMINAL_MIN_COLS = 2;
export const TERMINAL_MAX_COLS = 300;
export const TERMINAL_MIN_ROWS = 2;
export const TERMINAL_MAX_ROWS = 200;
export const TERMINAL_DEFAULT_COLS = 80;
export const TERMINAL_DEFAULT_ROWS = 24;

export type TerminalClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

export type TerminalClientMessageRejection =
  | "INVALID_JSON"
  | "INVALID_SHAPE"
  | "UNKNOWN_MESSAGE_TYPE"
  | "INPUT_EMPTY"
  | "INPUT_CONTAINS_NUL"
  | "INPUT_TOO_LARGE"
  | "RESIZE_OUT_OF_RANGE";

export type TerminalClientMessageParseResult =
  | { parsed: true; message: TerminalClientMessage }
  | { parsed: false; reason: TerminalClientMessageRejection };

export interface TerminalExitEvent {
  exitCode: number;
  signal?: number;
}

export function parseTerminalClientMessage(frame: string): TerminalClientMessageParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame) as unknown;
  } catch {
    return { parsed: false, reason: "INVALID_JSON" };
  }

  if (!isPlainRecord(parsed) || typeof parsed.type !== "string") {
    return { parsed: false, reason: "INVALID_SHAPE" };
  }

  switch (parsed.type) {
    case "input":
      return parseInputMessage(parsed);
    case "resize":
      return parseResizeMessage(parsed);
    default:
      return { parsed: false, reason: "UNKNOWN_MESSAGE_TYPE" };
  }
}

export function serializeTerminalReadyFrame(): string {
  return JSON.stringify({ type: "ready" });
}

export function serializeTerminalOutputFrame(data: string): string {
  return JSON.stringify({ type: "output", data });
}

export function serializeTerminalExitFrame(event: TerminalExitEvent): string {
  const exitCode = normalizeNonNegativeInteger(event.exitCode);
  const signal =
    event.signal === undefined ? undefined : normalizeNonNegativeInteger(event.signal);

  return JSON.stringify({
    type: "exit",
    exitCode,
    ...(signal === undefined ? {} : { signal }),
  });
}

export function splitTerminalOutput(data: string): string[] {
  if (data.length === 0) return [];

  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const codePoint of data) {
    const codePointBytes = Buffer.byteLength(codePoint, "utf8");
    if (current.length > 0 && currentBytes + codePointBytes > TERMINAL_OUTPUT_FRAME_MAX_BYTES) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += codePoint;
    currentBytes += codePointBytes;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function parseInputMessage(value: Record<string, unknown>): TerminalClientMessageParseResult {
  if (!hasExactKeys(value, ["type", "data"]) || typeof value.data !== "string") {
    return { parsed: false, reason: "INVALID_SHAPE" };
  }
  if (value.data.length === 0) return { parsed: false, reason: "INPUT_EMPTY" };
  if (value.data.includes("\0")) return { parsed: false, reason: "INPUT_CONTAINS_NUL" };
  if (Buffer.byteLength(value.data, "utf8") > TERMINAL_INPUT_MAX_BYTES) {
    return { parsed: false, reason: "INPUT_TOO_LARGE" };
  }
  return { parsed: true, message: { type: "input", data: value.data } };
}

function parseResizeMessage(value: Record<string, unknown>): TerminalClientMessageParseResult {
  if (
    !hasExactKeys(value, ["type", "cols", "rows"]) ||
    typeof value.cols !== "number" ||
    typeof value.rows !== "number" ||
    !Number.isInteger(value.cols) ||
    !Number.isInteger(value.rows)
  ) {
    return { parsed: false, reason: "INVALID_SHAPE" };
  }

  if (
    value.cols < TERMINAL_MIN_COLS ||
    value.cols > TERMINAL_MAX_COLS ||
    value.rows < TERMINAL_MIN_ROWS ||
    value.rows > TERMINAL_MAX_ROWS
  ) {
    return { parsed: false, reason: "RESIZE_OUT_OF_RANGE" };
  }

  return { parsed: true, message: { type: "resize", cols: value.cols, rows: value.rows } };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

function normalizeNonNegativeInteger(value: number): number {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}
