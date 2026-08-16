import { isTerminalSessionToken } from "./terminal-session-security.js";

export const TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL = "dashboard-rpi5-terminal-v1";
export const TERMINAL_WEBSOCKET_SESSION_PROTOCOL_PREFIX = "session.";
export const TERMINAL_WEBSOCKET_PROTOCOL_HEADER_MAX_LENGTH = 128;

export type TerminalWebSocketProtocolRejection =
  | "PROTOCOL_HEADER_REQUIRED"
  | "PROTOCOL_HEADER_INVALID";

export type TerminalWebSocketProtocolParseResult =
  | { parsed: true; sessionToken: string }
  | { parsed: false; reason: TerminalWebSocketProtocolRejection };

export function parseTerminalWebSocketProtocolHeader(
  value: string | string[] | undefined,
): TerminalWebSocketProtocolParseResult {
  if (value === undefined || value.length === 0) {
    return { parsed: false, reason: "PROTOCOL_HEADER_REQUIRED" };
  }
  if (
    typeof value !== "string" ||
    value.length > TERMINAL_WEBSOCKET_PROTOCOL_HEADER_MAX_LENGTH ||
    value.includes("\r") ||
    value.includes("\n")
  ) {
    return { parsed: false, reason: "PROTOCOL_HEADER_INVALID" };
  }

  const parts = value.split(",");
  if (parts.length !== 2) {
    return { parsed: false, reason: "PROTOCOL_HEADER_INVALID" };
  }

  const applicationProtocol = trimHttpOws(parts[0] ?? "");
  const sessionProtocol = trimHttpOws(parts[1] ?? "");
  if (
    applicationProtocol !== TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL ||
    !sessionProtocol.startsWith(TERMINAL_WEBSOCKET_SESSION_PROTOCOL_PREFIX)
  ) {
    return { parsed: false, reason: "PROTOCOL_HEADER_INVALID" };
  }

  const sessionToken = sessionProtocol.slice(TERMINAL_WEBSOCKET_SESSION_PROTOCOL_PREFIX.length);
  if (!isTerminalSessionToken(sessionToken)) {
    return { parsed: false, reason: "PROTOCOL_HEADER_INVALID" };
  }

  return { parsed: true, sessionToken };
}

export function selectTerminalWebSocketApplicationProtocol(
  protocols: ReadonlySet<string>,
): string | false {
  if (
    protocols.size !== 2 ||
    !protocols.has(TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL)
  ) {
    return false;
  }

  for (const protocol of protocols) {
    if (protocol === TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL) {
      continue;
    }
    if (!protocol.startsWith(TERMINAL_WEBSOCKET_SESSION_PROTOCOL_PREFIX)) {
      return false;
    }
    const sessionToken = protocol.slice(TERMINAL_WEBSOCKET_SESSION_PROTOCOL_PREFIX.length);
    return isTerminalSessionToken(sessionToken)
      ? TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL
      : false;
  }

  return false;
}

function trimHttpOws(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isHttpOws(value.charCodeAt(start))) {
    start += 1;
  }
  while (end > start && isHttpOws(value.charCodeAt(end - 1))) {
    end -= 1;
  }
  return value.slice(start, end);
}

function isHttpOws(code: number): boolean {
  return code === 0x20 || code === 0x09;
}
