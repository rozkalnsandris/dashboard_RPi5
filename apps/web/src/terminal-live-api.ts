import type { TerminalSessionGrant } from "@dashboard-rpi5/contracts/terminal";

export const TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL = "dashboard-rpi5-terminal-v1";
export const TERMINAL_WEBSOCKET_SESSION_PROTOCOL_PREFIX = "session.";
export const TERMINAL_WEBSOCKET_PATH = "/api/terminal/ws";
export const TERMINAL_INPUT_MAX_BYTES = 2 * 1024;
export const TERMINAL_UI_INPUT_EVENT_MAX_BYTES = 16 * 1024;
export const TERMINAL_WEBSOCKET_FRAME_MAX_BYTES = 4 * 1024;
export const TERMINAL_SERVER_OUTPUT_MAX_BYTES = 16 * 1024;
export const TERMINAL_MIN_COLS = 2;
export const TERMINAL_MAX_COLS = 300;
export const TERMINAL_MIN_ROWS = 2;
export const TERMINAL_MAX_ROWS = 200;

const SESSION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const UTF8 = new TextEncoder();
const INPUT_FRAME_FIXED_BYTES = UTF8.encode(
  JSON.stringify({ type: "input", data: "" }),
).byteLength;

export type TerminalSessionRequestErrorKind =
  | "TERMINAL_UNAVAILABLE"
  | "ADMISSION_DENIED"
  | "SESSION_LIMIT"
  | "AUTH_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "REQUEST_FAILED";

export class TerminalSessionRequestError extends Error {
  constructor(readonly kind: TerminalSessionRequestErrorKind) {
    super(kind);
    this.name = "TerminalSessionRequestError";
  }
}

export type TerminalServerFrame =
  | { type: "ready" }
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number; signal?: number };

export type TerminalInputSerializeResult =
  | { ok: true; frames: string[] }
  | { ok: false; reason: "EMPTY" | "NUL" | "EVENT_TOO_LARGE" };

export async function createTerminalSession(signal?: AbortSignal): Promise<TerminalSessionGrant> {
  let response: Response;
  try {
    response = await fetch("/api/terminal/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw new TerminalSessionRequestError("REQUEST_FAILED");
  }

  if (!response.ok) {
    throw new TerminalSessionRequestError(errorKindForStatus(response.status));
  }

  let value: unknown;
  try {
    value = await response.json() as unknown;
  } catch {
    throw new TerminalSessionRequestError("INVALID_RESPONSE");
  }

  const grant = parseTerminalSessionGrant(value);
  if (grant === null) {
    throw new TerminalSessionRequestError("INVALID_RESPONSE");
  }
  return grant;
}

export function parseTerminalSessionGrant(value: unknown): TerminalSessionGrant | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["sessionToken", "idleTimeoutMs", "maxLifetimeMs"])) {
    return null;
  }
  if (
    typeof value.sessionToken !== "string" ||
    !SESSION_TOKEN_PATTERN.test(value.sessionToken) ||
    value.idleTimeoutMs !== 300_000 ||
    value.maxLifetimeMs !== 1_800_000
  ) {
    return null;
  }
  return {
    sessionToken: value.sessionToken,
    idleTimeoutMs: value.idleTimeoutMs,
    maxLifetimeMs: value.maxLifetimeMs,
  };
}

export function terminalWebSocketUrlFromLocation(
  location: Pick<Location, "protocol" | "host">,
): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}${TERMINAL_WEBSOCKET_PATH}`;
}

export function terminalWebSocketProtocols(sessionToken: string): [string, string] {
  if (!SESSION_TOKEN_PATTERN.test(sessionToken)) {
    throw new TerminalSessionRequestError("INVALID_RESPONSE");
  }
  return [
    TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL,
    `${TERMINAL_WEBSOCKET_SESSION_PROTOCOL_PREFIX}${sessionToken}`,
  ];
}

export function createTerminalWebSocket(sessionToken: string): WebSocket {
  return new WebSocket(
    terminalWebSocketUrlFromLocation(window.location),
    terminalWebSocketProtocols(sessionToken),
  );
}

export function parseTerminalServerFrame(frame: string): TerminalServerFrame | null {
  if (UTF8.encode(frame).byteLength > TERMINAL_SERVER_OUTPUT_MAX_BYTES + 256) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(frame) as unknown;
  } catch {
    return null;
  }
  if (!isPlainRecord(value) || typeof value.type !== "string") return null;

  switch (value.type) {
    case "ready":
      return hasExactKeys(value, ["type"]) ? { type: "ready" } : null;
    case "output":
      if (
        !hasExactKeys(value, ["type", "data"]) ||
        typeof value.data !== "string" ||
        UTF8.encode(value.data).byteLength > TERMINAL_SERVER_OUTPUT_MAX_BYTES
      ) {
        return null;
      }
      return { type: "output", data: value.data };
    case "exit": {
      const keysAreValid = hasExactKeys(value, ["type", "exitCode"]) ||
        hasExactKeys(value, ["type", "exitCode", "signal"]);
      if (
        !keysAreValid ||
        !isNonNegativeInteger(value.exitCode) ||
        ("signal" in value && !isNonNegativeInteger(value.signal))
      ) {
        return null;
      }
      return "signal" in value
        ? { type: "exit", exitCode: value.exitCode, signal: value.signal as number }
        : { type: "exit", exitCode: value.exitCode };
    }
    default:
      return null;
  }
}

export function serializeTerminalInputFrames(data: string): TerminalInputSerializeResult {
  if (data.length === 0) return { ok: false, reason: "EMPTY" };
  if (data.includes("\0")) return { ok: false, reason: "NUL" };
  if (UTF8.encode(data).byteLength > TERMINAL_UI_INPUT_EVENT_MAX_BYTES) {
    return { ok: false, reason: "EVENT_TOO_LARGE" };
  }

  const frames: string[] = [];
  let current = "";
  let currentDataBytes = 0;
  let currentEscapedBytes = 0;

  const flush = () => {
    if (current.length === 0) return;
    frames.push(JSON.stringify({ type: "input", data: current }));
    current = "";
    currentDataBytes = 0;
    currentEscapedBytes = 0;
  };

  for (const codePoint of data) {
    const dataBytes = UTF8.encode(codePoint).byteLength;
    const escaped = JSON.stringify(codePoint).slice(1, -1);
    const escapedBytes = UTF8.encode(escaped).byteLength;
    if (
      current.length > 0 &&
      (currentDataBytes + dataBytes > TERMINAL_INPUT_MAX_BYTES ||
        INPUT_FRAME_FIXED_BYTES + currentEscapedBytes + escapedBytes > TERMINAL_WEBSOCKET_FRAME_MAX_BYTES)
    ) {
      flush();
    }
    current += codePoint;
    currentDataBytes += dataBytes;
    currentEscapedBytes += escapedBytes;
  }
  flush();
  return { ok: true, frames };
}

export function serializeTerminalResizeFrame(cols: number, rows: number): string | null {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < TERMINAL_MIN_COLS ||
    cols > TERMINAL_MAX_COLS ||
    rows < TERMINAL_MIN_ROWS ||
    rows > TERMINAL_MAX_ROWS
  ) {
    return null;
  }
  return JSON.stringify({ type: "resize", cols, rows });
}

function errorKindForStatus(status: number): TerminalSessionRequestErrorKind {
  switch (status) {
    case 404:
      return "TERMINAL_UNAVAILABLE";
    case 403:
      return "ADMISSION_DENIED";
    case 409:
      return "SESSION_LIMIT";
    case 503:
      return "AUTH_UNAVAILABLE";
    default:
      return "REQUEST_FAILED";
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index]);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
