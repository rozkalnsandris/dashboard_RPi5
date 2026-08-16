import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TERMINAL_OUTPUT_BUFFER_MAX_BYTES,
  TERMINAL_OUTPUT_FRAME_MAX_BYTES,
  type TerminalExitEvent,
} from "./terminal-application-protocol.js";
import {
  attachTerminalPtyLifecycle,
  type TerminalDisposable,
  type TerminalProtocolSocket,
  type TerminalPtyFactory,
  type TerminalPtyProcess,
} from "./terminal-pty-lifecycle.js";
import {
  TERMINAL_EXPECTED_ORIGIN,
  TERMINAL_IDLE_TIMEOUT_MS,
  TERMINAL_MAX_LIFETIME_MS,
  TerminalSessionRegistry,
} from "./terminal-session-security.js";

const TOKEN = "a".repeat(64);

class FakeSocket implements TerminalProtocolSocket {
  bufferedAmount = 0;
  readonly sent: string[] = [];
  readonly closes: Array<{ code: number; reason: string }> = [];
  throwOnSend = false;

  send(data: string): void {
    if (this.throwOnSend) {
      throw new Error("fixture send failure");
    }
    this.sent.push(data);
  }

  close(code: number, reason: string): void {
    this.closes.push({ code, reason });
  }
}

class FakePty implements TerminalPtyProcess {
  readonly writes: string[] = [];
  readonly resizes: Array<{ cols: number; rows: number }> = [];
  killCount = 0;
  dataListener: ((data: string) => void) | undefined;
  exitListener: ((event: TerminalExitEvent) => void) | undefined;

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  kill(): void {
    this.killCount += 1;
  }

  onData(listener: (data: string) => void): TerminalDisposable {
    this.dataListener = listener;
    return { dispose: () => (this.dataListener = undefined) };
  }

  onExit(listener: (event: TerminalExitEvent) => void): TerminalDisposable {
    this.exitListener = listener;
    return { dispose: () => (this.exitListener = undefined) };
  }

  emitData(data: string): void {
    this.dataListener?.(data);
  }

  emitExit(event: TerminalExitEvent): void {
    this.exitListener?.(event);
  }
}

function createClaimedRegistry(): TerminalSessionRegistry {
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

function attachFixture() {
  const registry = createClaimedRegistry();
  const socket = new FakeSocket();
  const pty = new FakePty();
  const create = vi.fn(() => pty);
  const factory: TerminalPtyFactory = { create };
  const attached = attachTerminalPtyLifecycle({
    socket,
    sessionToken: TOKEN,
    sessionRegistry: registry,
    ptyFactory: factory,
  });
  expect(attached.attached).toBe(true);
  if (!attached.attached) {
    throw new Error("Expected PTY lifecycle fixture to attach");
  }
  return { registry, socket, pty, create, session: attached.session };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("terminal PTY lifecycle controller", () => {
  it("creates exactly one fixed-shape PTY and handles bounded input/resize", () => {
    vi.useFakeTimers();
    const { socket, pty, create, session } = attachFixture();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ cols: 80, rows: 24 });
    expect(socket.sent).toEqual(['{"type":"ready"}']);

    session.handleClientFrame(JSON.stringify({ type: "input", data: "pwd\r" }), false);
    session.handleClientFrame(JSON.stringify({ type: "resize", cols: 100, rows: 30 }), false);

    expect(pty.writes).toEqual(["pwd\r"]);
    expect(pty.resizes).toEqual([{ cols: 100, rows: 30 }]);
    expect(pty.killCount).toBe(0);
  });

  it("kills and revokes on binary or malformed client protocol", () => {
    vi.useFakeTimers();
    const first = attachFixture();
    first.session.handleClientFrame("ignored", true);

    expect(first.pty.killCount).toBe(1);
    expect(first.registry.activeCount()).toBe(0);
    expect(first.socket.closes).toEqual([
      { code: 1008, reason: "TERMINAL_PROTOCOL_VIOLATION" },
    ]);

    const second = attachFixture();
    second.session.handleClientFrame('{"type":"input","data":"x","extra":true}', false);
    expect(second.pty.killCount).toBe(1);
    expect(second.registry.activeCount()).toBe(0);
  });

  it("counts accepted client activity for idle timeout but PTY output does not", () => {
    vi.useFakeTimers();
    const active = attachFixture();

    vi.advanceTimersByTime(TERMINAL_IDLE_TIMEOUT_MS - 60_000);
    active.session.handleClientFrame(JSON.stringify({ type: "input", data: "x" }), false);
    vi.advanceTimersByTime(TERMINAL_IDLE_TIMEOUT_MS - 1);
    expect(active.pty.killCount).toBe(0);
    vi.advanceTimersByTime(1);
    expect(active.pty.killCount).toBe(1);
    expect(active.socket.closes.at(-1)).toEqual({
      code: 1008,
      reason: "TERMINAL_IDLE_TIMEOUT",
    });

    const outputOnly = attachFixture();
    vi.advanceTimersByTime(TERMINAL_IDLE_TIMEOUT_MS - 1);
    outputOnly.pty.emitData("still-running\r\n");
    vi.advanceTimersByTime(1);
    expect(outputOnly.pty.killCount).toBe(1);
    expect(outputOnly.socket.closes.at(-1)?.reason).toBe("TERMINAL_IDLE_TIMEOUT");
  });

  it("never lets activity extend the absolute maximum lifetime", () => {
    vi.useFakeTimers();
    const { pty, socket, session } = attachFixture();

    for (let elapsed = 4 * 60_000; elapsed < TERMINAL_MAX_LIFETIME_MS; elapsed += 4 * 60_000) {
      vi.advanceTimersByTime(4 * 60_000);
      if (elapsed < TERMINAL_MAX_LIFETIME_MS) {
        session.handleClientFrame(JSON.stringify({ type: "input", data: "x" }), false);
      }
    }

    const remaining = TERMINAL_MAX_LIFETIME_MS % (4 * 60_000);
    if (remaining > 0) {
      vi.advanceTimersByTime(remaining);
    }

    expect(pty.killCount).toBe(1);
    expect(socket.closes.at(-1)).toEqual({
      code: 1008,
      reason: "TERMINAL_MAX_LIFETIME",
    });
  });

  it("chunks PTY output and fails closed when socket buffering is excessive", () => {
    vi.useFakeTimers();
    const { pty, socket, registry } = attachFixture();
    pty.emitData("a".repeat(TERMINAL_OUTPUT_FRAME_MAX_BYTES + 10));

    expect(socket.sent[0]).toBe('{"type":"ready"}');
    expect(socket.sent.filter((frame) => frame.includes('"type":"output"'))).toHaveLength(2);
    expect(pty.killCount).toBe(0);

    socket.bufferedAmount = TERMINAL_OUTPUT_BUFFER_MAX_BYTES;
    pty.emitData("blocked");
    expect(pty.killCount).toBe(1);
    expect(registry.activeCount()).toBe(0);
    expect(socket.closes.at(-1)).toEqual({
      code: 1013,
      reason: "TERMINAL_OUTPUT_OVERLOAD",
    });
  });

  it("sends a bounded exit frame without killing an already-exited PTY", () => {
    vi.useFakeTimers();
    const { pty, socket, registry } = attachFixture();
    pty.emitExit({ exitCode: 7, signal: 15 });

    expect(socket.sent.at(-1)).toBe('{"type":"exit","exitCode":7,"signal":15}');
    expect(socket.closes).toEqual([{ code: 1000, reason: "TERMINAL_EXIT" }]);
    expect(pty.killCount).toBe(0);
    expect(registry.activeCount()).toBe(0);
  });

  it("kills and revokes on disconnect without trying to close an already-gone socket", () => {
    vi.useFakeTimers();
    const { pty, socket, registry, session } = attachFixture();
    session.disconnect();
    session.disconnect();

    expect(pty.killCount).toBe(1);
    expect(registry.activeCount()).toBe(0);
    expect(socket.closes).toEqual([]);
  });

  it("fails closed if PTY creation throws and never leaves the capability live", () => {
    vi.useFakeTimers();
    const registry = createClaimedRegistry();
    const socket = new FakeSocket();
    const result = attachTerminalPtyLifecycle({
      socket,
      sessionToken: TOKEN,
      sessionRegistry: registry,
      ptyFactory: {
        create() {
          throw new Error("fixture PTY unavailable");
        },
      },
    });

    expect(result).toEqual({ attached: false, reason: "PTY_SETUP_FAILED" });
    expect(registry.activeCount()).toBe(0);
    expect(socket.sent).toEqual([]);
  });
});
