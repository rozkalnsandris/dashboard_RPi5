import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachTerminalWebSocketBridge,
  TERMINAL_BRIDGE_EXIT_SEND_TIMEOUT_MS,
  TERMINAL_BRIDGE_MAX_WEBSOCKET_BUFFER_BYTES,
  type TerminalBridgeWebSocket,
} from "./terminal-websocket-bridge.js";
import {
  TERMINAL_EXPECTED_ORIGIN,
  TerminalSessionRegistry,
} from "./terminal-session-security.js";

const TOKEN = "a".repeat(64);

class FakeLocalSocket extends Duplex {
  readonly writes: string[] = [];

  override _read(): void {}

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    void encoding;
    this.writes.push(chunk.toString());
    callback();
  }

  connectNow(): void {
    this.emit("connect");
  }

  serverSend(frame: object): void {
    this.push(`${JSON.stringify(frame)}\n`);
  }

  serverSendRaw(data: string): void {
    this.push(data);
  }
}

class FakeWebSocket extends EventEmitter implements TerminalBridgeWebSocket {
  bufferedAmount = 0;
  deferSendCallbacks = false;
  readonly sent: string[] = [];
  readonly closes: Array<{ code: number; reason: string }> = [];
  readonly pendingSendCallbacks: Array<(error?: Error) => void> = [];
  terminated = false;

  send(data: string, callback?: (error?: Error) => void): void {
    this.sent.push(data);
    if (callback === undefined) return;
    if (this.deferSendCallbacks) {
      this.pendingSendCallbacks.push(callback);
      return;
    }
    callback();
  }

  completeNextSend(error?: Error): void {
    const callback = this.pendingSendCallbacks.shift();
    callback?.(error);
  }

  close(code: number, reason: string): void {
    this.closes.push({ code, reason });
    this.emit("close");
  }

  terminate(): void {
    this.terminated = true;
    this.emit("close");
  }

  browserSend(value: unknown, isBinary = false): void {
    const payload = typeof value === "string" ? Buffer.from(value, "utf8") : value;
    this.emit("message", payload, isBinary);
  }
}

function claimedRegistry(): TerminalSessionRegistry {
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
  return registry;
}

function harness() {
  const socket = new FakeWebSocket();
  const local = new FakeLocalSocket();
  const registry = claimedRegistry();
  attachTerminalWebSocketBridge({
    socket,
    sessionToken: TOKEN,
    sessionRegistry: registry,
    localConnector: () => local as unknown as Socket,
  });
  return { socket, local, registry };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("terminal websocket Unix bridge", () => {
  it("rejects browser frames synchronously until the local worker is ready", () => {
    const session = harness();
    session.socket.browserSend(JSON.stringify({ type: "input", data: "id\r" }));

    expect(session.socket.closes).toEqual([{ code: 1008, reason: "TERMINAL_NOT_READY" }]);
    expect(session.local.destroyed).toBe(true);
    expect(session.registry.activeCount()).toBe(0);
    expect(session.local.writes).toEqual([]);
  });

  it("opens fixed 80x24 locally then translates input, resize, output and exit", () => {
    const session = harness();
    session.local.connectNow();
    expect(session.local.writes).toEqual([
      '{"v":1,"type":"open","cols":80,"rows":24}\n',
    ]);

    session.local.serverSend({ v: 1, type: "ready" });
    expect(session.socket.sent).toEqual(['{"type":"ready"}']);

    session.socket.browserSend(JSON.stringify({ type: "input", data: "pwd\r" }));
    session.socket.browserSend(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
    expect(session.local.writes.slice(1)).toEqual([
      '{"v":1,"type":"input","data":"pwd\\r"}\n',
      '{"v":1,"type":"resize","cols":120,"rows":40}\n',
    ]);

    session.local.serverSend({ v: 1, type: "output", data: "hello 🧪\r\n" });
    expect(session.socket.sent.at(-1)).toBe(
      '{"type":"output","data":"hello 🧪\\r\\n"}',
    );

    session.local.serverSend({ v: 1, type: "exit", code: 0, signal: null });
    expect(session.socket.sent.at(-1)).toBe('{"type":"exit","exitCode":0}');
    expect(session.socket.closes.at(-1)).toEqual({ code: 1000, reason: "TERMINAL_EXIT" });
    expect(session.registry.activeCount()).toBe(0);
    expect(session.local.destroyed).toBe(true);
  });

  it("does not close normally until the exit frame send callback succeeds", () => {
    const session = harness();
    session.local.connectNow();
    session.local.serverSend({ v: 1, type: "ready" });
    session.socket.deferSendCallbacks = true;

    session.local.serverSend({ v: 1, type: "exit", code: 0, signal: null });
    expect(session.socket.sent.at(-1)).toBe('{"type":"exit","exitCode":0}');
    expect(session.socket.closes).toEqual([]);
    expect(session.registry.activeCount()).toBe(0);
    expect(session.local.destroyed).toBe(true);

    session.socket.completeNextSend();
    expect(session.socket.closes).toEqual([{ code: 1000, reason: "TERMINAL_EXIT" }]);
  });

  it("terminates if an exit frame cannot complete within the bounded deadline", async () => {
    vi.useFakeTimers();
    const session = harness();
    session.local.connectNow();
    session.local.serverSend({ v: 1, type: "ready" });
    session.socket.deferSendCallbacks = true;

    session.local.serverSend({ v: 1, type: "exit", code: 0, signal: null });
    await vi.advanceTimersByTimeAsync(TERMINAL_BRIDGE_EXIT_SEND_TIMEOUT_MS);

    expect(session.socket.terminated).toBe(true);
    expect(session.socket.closes).toEqual([]);
    expect(session.registry.activeCount()).toBe(0);
  });

  it("rejects binary and NUL browser input before it reaches the local worker", () => {
    const binary = harness();
    binary.local.connectNow();
    binary.local.serverSend({ v: 1, type: "ready" });
    binary.socket.browserSend(Buffer.from("x"), true);
    expect(binary.socket.closes.at(-1)).toEqual({
      code: 1008,
      reason: "TERMINAL_PROTOCOL_ERROR",
    });
    expect(binary.local.writes).toHaveLength(1);

    const nul = harness();
    nul.local.connectNow();
    nul.local.serverSend({ v: 1, type: "ready" });
    nul.socket.browserSend(JSON.stringify({ type: "input", data: "a\0b" }));
    expect(nul.socket.closes.at(-1)).toEqual({
      code: 1008,
      reason: "TERMINAL_PROTOCOL_ERROR",
    });
    expect(nul.local.writes).toHaveLength(1);
  });

  it("fails closed on malformed or unexpected local protocol", () => {
    const session = harness();
    session.local.connectNow();
    session.local.serverSendRaw('{"v":1,"type":"root"}\n');

    expect(session.socket.closes.at(-1)).toEqual({
      code: 1011,
      reason: "TERMINAL_LOCAL_PROTOCOL_ERROR",
    });
    expect(session.registry.activeCount()).toBe(0);
  });

  it("maps local expiry and output overload to fixed websocket close classes", () => {
    const expired = harness();
    expired.local.connectNow();
    expired.local.serverSend({ v: 1, type: "error", code: "SESSION_EXPIRED" });
    expect(expired.socket.closes.at(-1)).toEqual({
      code: 1008,
      reason: "TERMINAL_SESSION_EXPIRED",
    });

    const overloaded = harness();
    overloaded.local.connectNow();
    overloaded.local.serverSend({ v: 1, type: "error", code: "OUTPUT_OVERFLOW" });
    expect(overloaded.socket.closes.at(-1)).toEqual({
      code: 1013,
      reason: "TERMINAL_OUTPUT_OVERLOAD",
    });
  });

  it("fails closed when websocket output backpressure reaches the hard cap", () => {
    const session = harness();
    session.local.connectNow();
    session.local.serverSend({ v: 1, type: "ready" });
    session.socket.bufferedAmount = TERMINAL_BRIDGE_MAX_WEBSOCKET_BUFFER_BYTES;
    session.local.serverSend({ v: 1, type: "output", data: "x" });

    expect(session.socket.closes.at(-1)).toEqual({
      code: 1013,
      reason: "TERMINAL_OUTPUT_BACKPRESSURE",
    });
    expect(session.local.destroyed).toBe(true);
  });

  it("revokes and destroys the local side when the browser disconnects", () => {
    const session = harness();
    session.local.connectNow();
    session.local.serverSend({ v: 1, type: "ready" });
    session.socket.emit("close");

    expect(session.registry.activeCount()).toBe(0);
    expect(session.local.destroyed).toBe(true);
  });

  it("maps synchronous local connector failure to a fixed internal close", () => {
    const socket = new FakeWebSocket();
    const registry = claimedRegistry();
    attachTerminalWebSocketBridge({
      socket,
      sessionToken: TOKEN,
      sessionRegistry: registry,
      localConnector: () => {
        throw new Error("details must not escape");
      },
    });

    expect(socket.closes).toEqual([{ code: 1011, reason: "TERMINAL_LOCAL_UNAVAILABLE" }]);
    expect(registry.activeCount()).toBe(0);
  });
});
