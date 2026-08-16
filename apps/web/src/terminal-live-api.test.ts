import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTerminalSession,
  parseTerminalServerFrame,
  parseTerminalSessionGrant,
  serializeTerminalInputFrames,
  serializeTerminalResizeFrame,
  terminalWebSocketProtocols,
  terminalWebSocketUrlFromLocation,
  TerminalSessionRequestError,
  TERMINAL_INPUT_MAX_BYTES,
  TERMINAL_WEBSOCKET_FRAME_MAX_BYTES,
} from "./terminal-live-api";

const TOKEN = "a".repeat(64);
const encoder = new TextEncoder();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("terminal live browser protocol", () => {
  it("accepts only the exact terminal session grant contract", () => {
    expect(parseTerminalSessionGrant({
      sessionToken: TOKEN,
      idleTimeoutMs: 300_000,
      maxLifetimeMs: 1_800_000,
    })).toEqual({
      sessionToken: TOKEN,
      idleTimeoutMs: 300_000,
      maxLifetimeMs: 1_800_000,
    });
    expect(parseTerminalSessionGrant({
      sessionToken: TOKEN,
      idleTimeoutMs: 300_000,
      maxLifetimeMs: 1_800_000,
      extra: true,
    })).toBeNull();
    expect(parseTerminalSessionGrant({
      sessionToken: "not-a-token",
      idleTimeoutMs: 300_000,
      maxLifetimeMs: 1_800_000,
    })).toBeNull();
  });

  it("keeps the one-time token out of the websocket URL", () => {
    const url = terminalWebSocketUrlFromLocation({ protocol: "https:", host: "dash.rozkalns.net" });
    expect(url).toBe("wss://dash.rozkalns.net/api/terminal/ws");
    expect(url).not.toContain(TOKEN);
    expect(terminalWebSocketProtocols(TOKEN)).toEqual([
      "dashboard-rpi5-terminal-v1",
      `session.${TOKEN}`,
    ]);
  });

  it("maps admission failures to bounded client error classes without reflecting bodies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"secret":"must-not-reflect"}', { status: 404 })));
    await expect(createTerminalSession()).rejects.toMatchObject({
      name: "TerminalSessionRequestError",
      kind: "TERMINAL_UNAVAILABLE",
    });
  });

  it("rejects malformed successful session responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      sessionToken: TOKEN,
      idleTimeoutMs: 1,
      maxLifetimeMs: 2,
    }), { status: 201, headers: { "Content-Type": "application/json" } })));
    await expect(createTerminalSession()).rejects.toEqual(
      new TerminalSessionRequestError("INVALID_RESPONSE"),
    );
  });

  it("parses only ready, bounded output and non-negative exit frames", () => {
    expect(parseTerminalServerFrame('{"type":"ready"}')).toEqual({ type: "ready" });
    expect(parseTerminalServerFrame('{"type":"output","data":"hello"}')).toEqual({
      type: "output",
      data: "hello",
    });
    expect(parseTerminalServerFrame('{"type":"exit","exitCode":0}')).toEqual({
      type: "exit",
      exitCode: 0,
    });
    expect(parseTerminalServerFrame('{"type":"exit","exitCode":1,"signal":15}')).toEqual({
      type: "exit",
      exitCode: 1,
      signal: 15,
    });
    expect(parseTerminalServerFrame('{"type":"output","data":"x","extra":true}')).toBeNull();
    expect(parseTerminalServerFrame('{"type":"root"}')).toBeNull();
    expect(parseTerminalServerFrame('{"type":"exit","exitCode":-1}')).toBeNull();
  });

  it("splits paste input by both raw UTF-8 and serialized websocket frame bounds", () => {
    const value = `${"é".repeat(2_000)}${"\u0001".repeat(1_000)}`;
    const result = serializeTerminalInputFrames(value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames.length).toBeGreaterThan(1);
    let reconstructed = "";
    for (const frame of result.frames) {
      expect(encoder.encode(frame).byteLength).toBeLessThanOrEqual(TERMINAL_WEBSOCKET_FRAME_MAX_BYTES);
      const parsed = JSON.parse(frame) as { type: string; data: string };
      expect(parsed.type).toBe("input");
      expect(encoder.encode(parsed.data).byteLength).toBeLessThanOrEqual(TERMINAL_INPUT_MAX_BYTES);
      reconstructed += parsed.data;
    }
    expect(reconstructed).toBe(value);
  });

  it("rejects NUL and excessively large input events before websocket send", () => {
    expect(serializeTerminalInputFrames("a\0b")).toEqual({ ok: false, reason: "NUL" });
    expect(serializeTerminalInputFrames("x".repeat(16 * 1024 + 1))).toEqual({
      ok: false,
      reason: "EVENT_TOO_LARGE",
    });
  });

  it("serializes only resize dimensions accepted by the server contract", () => {
    expect(serializeTerminalResizeFrame(80, 24)).toBe('{"type":"resize","cols":80,"rows":24}');
    expect(serializeTerminalResizeFrame(1, 24)).toBeNull();
    expect(serializeTerminalResizeFrame(80, 201)).toBeNull();
    expect(serializeTerminalResizeFrame(80.5, 24)).toBeNull();
  });
});
