import { describe, expect, it } from "vitest";

import {
  parseTerminalWebSocketProtocolHeader,
  selectTerminalWebSocketApplicationProtocol,
  TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL,
  TERMINAL_WEBSOCKET_PROTOCOL_HEADER_MAX_LENGTH,
  TERMINAL_WEBSOCKET_SESSION_PROTOCOL_PREFIX,
} from "./terminal-websocket-protocol.js";

const TOKEN = "a".repeat(64);
const SESSION_PROTOCOL = `${TERMINAL_WEBSOCKET_SESSION_PROTOCOL_PREFIX}${TOKEN}`;
const VALID_HEADER = `${TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL}, ${SESSION_PROTOCOL}`;

describe("terminal WebSocket subprotocol carrier", () => {
  it.each([
    VALID_HEADER,
    `${TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL},${SESSION_PROTOCOL}`,
    `${TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL},\t${SESSION_PROTOCOL}`,
    ` ${TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL} , ${SESSION_PROTOCOL} `,
  ])("extracts only the bounded session token from %s", (header) => {
    const parsed = parseTerminalWebSocketProtocolHeader(header);
    expect(parsed).toEqual({ parsed: true, sessionToken: TOKEN });
    expect(JSON.stringify(parsed)).not.toContain(TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL);
    expect(JSON.stringify(parsed)).not.toContain(header);
  });

  it("distinguishes an absent protocol header without synthesizing a token", () => {
    expect(parseTerminalWebSocketProtocolHeader(undefined)).toEqual({
      parsed: false,
      reason: "PROTOCOL_HEADER_REQUIRED",
    });
    expect(parseTerminalWebSocketProtocolHeader("")).toEqual({
      parsed: false,
      reason: "PROTOCOL_HEADER_REQUIRED",
    });
  });

  it.each([
    ["array-valued header", [VALID_HEADER]],
    ["reordered entries", `${SESSION_PROTOCOL}, ${TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL}`],
    ["missing session entry", TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL],
    ["extra entry", `${VALID_HEADER}, extra`],
    ["duplicate marker", `${TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL}, ${TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL}`],
    ["uppercase token", `${TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL}, session.${"A".repeat(64)}`],
    ["short token", `${TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL}, session.${"a".repeat(63)}`],
    ["wrong prefix", `${TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL}, token.${TOKEN}`],
    ["embedded whitespace", `${TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL}, session.${"a".repeat(32)} ${"a".repeat(32)}`],
    ["line break", `${TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL}, session.${TOKEN}\n`],
  ] as const)("rejects %s", (_name, header) => {
    expect(parseTerminalWebSocketProtocolHeader(header)).toEqual({
      parsed: false,
      reason: "PROTOCOL_HEADER_INVALID",
    });
  });

  it("rejects oversized protocol headers before parsing entries", () => {
    const header = `${VALID_HEADER}${"x".repeat(TERMINAL_WEBSOCKET_PROTOCOL_HEADER_MAX_LENGTH)}`;
    expect(header.length).toBeGreaterThan(TERMINAL_WEBSOCKET_PROTOCOL_HEADER_MAX_LENGTH);
    expect(parseTerminalWebSocketProtocolHeader(header)).toEqual({
      parsed: false,
      reason: "PROTOCOL_HEADER_INVALID",
    });
  });

  it("negotiates only the fixed application protocol and never the bearer token entry", () => {
    const protocols = new Set([TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL, SESSION_PROTOCOL]);
    const selected = selectTerminalWebSocketApplicationProtocol(protocols);
    expect(selected).toBe(TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL);
    expect(selected).not.toBe(SESSION_PROTOCOL);
    expect(selected).not.toContain(TOKEN);
  });

  it.each([
    new Set([SESSION_PROTOCOL]),
    new Set([TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL]),
    new Set([TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL, `session.${"A".repeat(64)}`]),
    new Set([TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL, SESSION_PROTOCOL, "extra"]),
  ])("refuses ambiguous or malformed protocol sets", (protocols) => {
    expect(selectTerminalWebSocketApplicationProtocol(protocols)).toBe(false);
  });
});
