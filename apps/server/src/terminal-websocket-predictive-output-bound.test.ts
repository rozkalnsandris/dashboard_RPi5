import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";

import {
  attachTerminalWebSocketBridge,
  TERMINAL_BRIDGE_MAX_WEBSOCKET_BUFFER_BYTES,
  type TerminalBridgeWebSocket,
} from "./terminal-websocket-bridge.js";
import {
  TERMINAL_EXPECTED_ORIGIN,
  TerminalSessionRegistry,
} from "./terminal-session-security.js";

const TOKEN = "b".repeat(64);

class FakeLocalSocket extends Duplex {
  override _read(): void {}
  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    void chunk;
    void encoding;
    callback();
  }

  connectNow(): void {
    this.emit("connect");
  }

  serverSend(frame: object): void {
    this.emit("data", Buffer.from(`${JSON.stringify(frame)}\n`, "utf8"));
  }
}

class FakeWebSocket extends EventEmitter implements TerminalBridgeWebSocket {
  bufferedAmount = 0;
  readonly sent: string[] = [];
  readonly closes: Array<{ code: number; reason: string }> = [];

  send(data: string, callback?: (error?: Error | null) => void): void {
    this.sent.push(data);
    callback?.();
  }

  close(code: number, reason: string): void {
    this.closes.push({ code, reason });
    this.emit("close", code);
  }

  terminate(): void {
    this.emit("close");
  }
}

function activeHarness() {
  const socket = new FakeWebSocket();
  const local = new FakeLocalSocket();
  const registry = new TerminalSessionRegistry({ tokenFactory: () => TOKEN });
  const created = registry.createSession({
    terminalEnabled: true,
    ownerAuthVerified: true,
    origin: TERMINAL_EXPECTED_ORIGIN,
  });
  expect(created.created).toBe(true);
  const claimed = registry.claimTransport({
    terminalEnabled: true,
    ownerAuthVerified: true,
    origin: TERMINAL_EXPECTED_ORIGIN,
    sessionToken: TOKEN,
  });
  expect(claimed.claimed).toBe(true);

  attachTerminalWebSocketBridge({
    socket,
    sessionToken: TOKEN,
    sessionRegistry: registry,
    localConnector: () => local as unknown as Socket,
  });
  local.connectNow();
  local.serverSend({ v: 1, type: "ready" });
  expect(socket.sent).toEqual(['{"type":"ready"}']);
  return { socket, local };
}

function outputFrame(data: string): string {
  return JSON.stringify({ type: "output", data });
}

describe("terminal websocket predictive output bound", () => {
  it("admits a small frame when projected pending output stays below the cap", () => {
    const session = activeHarness();
    const frame = outputFrame("ok");
    session.socket.bufferedAmount = 128;

    session.local.serverSend({ v: 1, type: "output", data: "ok" });

    expect(session.socket.sent.at(-1)).toBe(frame);
    expect(session.socket.closes).toEqual([]);
  });

  it("admits a frame whose projected UTF-8 payload is exactly at the cap", () => {
    const session = activeHarness();
    const frame = outputFrame("exact");
    session.socket.bufferedAmount =
      TERMINAL_BRIDGE_MAX_WEBSOCKET_BUFFER_BYTES - Buffer.byteLength(frame, "utf8");

    session.local.serverSend({ v: 1, type: "output", data: "exact" });

    expect(session.socket.sent.at(-1)).toBe(frame);
    expect(session.socket.closes).toEqual([]);
  });

  it("rejects before send when the candidate frame would cross the cap", () => {
    const session = activeHarness();
    const frame = outputFrame("cross");
    session.socket.bufferedAmount =
      TERMINAL_BRIDGE_MAX_WEBSOCKET_BUFFER_BYTES - Buffer.byteLength(frame, "utf8") + 1;
    const sentBefore = session.socket.sent.length;

    session.local.serverSend({ v: 1, type: "output", data: "cross" });

    expect(session.socket.sent).toHaveLength(sentBefore);
    expect(session.socket.closes.at(-1)).toEqual({
      code: 1013,
      reason: "TERMINAL_OUTPUT_BACKPRESSURE",
    });
    expect(session.local.destroyed).toBe(true);
  });

  it("accounts for Unicode as encoded UTF-8 bytes rather than string code units", () => {
    const session = activeHarness();
    const frame = outputFrame("🧪");
    expect(Buffer.byteLength(frame, "utf8")).toBeGreaterThan(frame.length);
    session.socket.bufferedAmount =
      TERMINAL_BRIDGE_MAX_WEBSOCKET_BUFFER_BYTES - frame.length;
    const sentBefore = session.socket.sent.length;

    session.local.serverSend({ v: 1, type: "output", data: "🧪" });

    expect(session.socket.sent).toHaveLength(sentBefore);
    expect(session.socket.closes.at(-1)).toEqual({
      code: 1013,
      reason: "TERMINAL_OUTPUT_BACKPRESSURE",
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    "fails closed on invalid bufferedAmount %s",
    (bufferedAmount) => {
      const session = activeHarness();
      session.socket.bufferedAmount = bufferedAmount;
      const sentBefore = session.socket.sent.length;

      session.local.serverSend({ v: 1, type: "output", data: "x" });

      expect(session.socket.sent).toHaveLength(sentBefore);
      expect(session.socket.closes.at(-1)).toEqual({
        code: 1013,
        reason: "TERMINAL_OUTPUT_BACKPRESSURE",
      });
    },
  );
});
