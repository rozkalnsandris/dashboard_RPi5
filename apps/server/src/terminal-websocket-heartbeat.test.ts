import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachTerminalWebSocketHeartbeat,
  TERMINAL_WEBSOCKET_HEARTBEAT_INTERVAL_MS,
  TERMINAL_WEBSOCKET_PONG_TIMEOUT_MS,
  type TerminalHeartbeatWebSocket,
} from "./terminal-websocket-heartbeat.js";

class FakeHeartbeatWebSocket extends EventEmitter implements TerminalHeartbeatWebSocket {
  pings = 0;
  terminated = false;
  throwOnPing = false;

  ping(): void {
    if (this.throwOnPing) throw new Error("ping failed");
    this.pings += 1;
  }

  terminate(): void {
    this.terminated = true;
    this.emit("close");
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("terminal websocket heartbeat", () => {
  it("keeps an idle transport alive with bounded ping/pong control frames", async () => {
    vi.useFakeTimers();
    const socket = new FakeHeartbeatWebSocket();
    attachTerminalWebSocketHeartbeat(socket);

    await vi.advanceTimersByTimeAsync(TERMINAL_WEBSOCKET_HEARTBEAT_INTERVAL_MS);
    expect(socket.pings).toBe(1);
    expect(socket.terminated).toBe(false);

    socket.emit("pong");
    await vi.advanceTimersByTimeAsync(TERMINAL_WEBSOCKET_HEARTBEAT_INTERVAL_MS);
    expect(socket.pings).toBe(2);
    expect(socket.terminated).toBe(false);

    socket.emit("pong");
    await vi.advanceTimersByTimeAsync(TERMINAL_WEBSOCKET_PONG_TIMEOUT_MS);
    expect(socket.terminated).toBe(false);
  });

  it("terminates a transport that does not answer the heartbeat", async () => {
    vi.useFakeTimers();
    const socket = new FakeHeartbeatWebSocket();
    attachTerminalWebSocketHeartbeat(socket);

    await vi.advanceTimersByTimeAsync(
      TERMINAL_WEBSOCKET_HEARTBEAT_INTERVAL_MS + TERMINAL_WEBSOCKET_PONG_TIMEOUT_MS,
    );

    expect(socket.pings).toBe(1);
    expect(socket.terminated).toBe(true);
  });

  it("stops heartbeat timers after browser close", async () => {
    vi.useFakeTimers();
    const socket = new FakeHeartbeatWebSocket();
    attachTerminalWebSocketHeartbeat(socket);

    socket.emit("close");
    await vi.advanceTimersByTimeAsync(TERMINAL_WEBSOCKET_HEARTBEAT_INTERVAL_MS * 2);

    expect(socket.pings).toBe(0);
    expect(socket.terminated).toBe(false);
  });

  it("fails closed if ping itself throws", async () => {
    vi.useFakeTimers();
    const socket = new FakeHeartbeatWebSocket();
    socket.throwOnPing = true;
    attachTerminalWebSocketHeartbeat(socket);

    await vi.advanceTimersByTimeAsync(TERMINAL_WEBSOCKET_HEARTBEAT_INTERVAL_MS);

    expect(socket.terminated).toBe(true);
  });
});
