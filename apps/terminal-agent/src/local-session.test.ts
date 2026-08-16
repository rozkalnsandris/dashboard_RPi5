import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TERMINAL_LOCAL_ABSOLUTE_TIMEOUT_MS,
  TERMINAL_LOCAL_IDLE_TIMEOUT_MS,
  TERMINAL_LOCAL_MAX_OUTPUT_EVENT_BYTES,
} from "./local-protocol.js";
import { runTerminalLocalSession } from "./local-session.js";
import type { TerminalNativePtyFactory } from "./native-pty.js";

function fakePty() {
  let dataListener: ((data: string) => void) | undefined;
  let exitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined;
  return {
    pid: 321,
    write: vi.fn((data: string) => void data),
    resize: vi.fn((cols: number, rows: number) => void [cols, rows]),
    kill: vi.fn(() => undefined),
    onData(listener: (data: string) => void) {
      dataListener = listener;
      return { dispose: () => (dataListener = undefined) };
    },
    onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
      exitListener = listener;
      return { dispose: () => (exitListener = undefined) };
    },
    emitData(data: string) {
      dataListener?.(data);
    },
    emitExit(exitCode: number, signal?: number) {
      exitListener?.(signal === undefined ? { exitCode } : { exitCode, signal });
    },
  };
}

function harness() {
  const input = new PassThrough();
  const output = new PassThrough();
  const outputText: string[] = [];
  output.setEncoding("utf8");
  output.on("data", (chunk: string) => outputText.push(chunk));
  const pty = fakePty();
  const create = vi.fn(() => pty);
  const factory: TerminalNativePtyFactory = { create };
  const loadPtyFactory = vi.fn(() => factory);
  const done = runTerminalLocalSession({ input, output, loadPtyFactory });

  return {
    input,
    output,
    pty,
    create,
    loadPtyFactory,
    done,
    text: () => outputText.join(""),
    send(value: unknown) {
      input.write(`${JSON.stringify(value)}\n`);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("terminal local session", () => {
  it("does not load native PTY code until a valid open frame is admitted", async () => {
    const session = harness();
    expect(session.loadPtyFactory).not.toHaveBeenCalled();

    session.send({ v: 1, type: "input", data: "id\r" });
    await session.done;

    expect(session.loadPtyFactory).not.toHaveBeenCalled();
    expect(session.text()).toContain('"code":"PROTOCOL_ERROR"');
  });

  it("opens exactly one PTY, forwards bounded input/resize and kills on client close", async () => {
    const session = harness();
    session.send({ v: 1, type: "open", cols: 80, rows: 24 });
    session.send({ v: 1, type: "input", data: "pwd\r" });
    session.send({ v: 1, type: "resize", cols: 120, rows: 40 });
    session.send({ v: 1, type: "close" });
    await session.done;

    expect(session.create).toHaveBeenCalledTimes(1);
    expect(session.create).toHaveBeenCalledWith({ cols: 80, rows: 24 });
    expect(session.pty.write).toHaveBeenCalledWith("pwd\r");
    expect(session.pty.resize).toHaveBeenCalledWith(120, 40);
    expect(session.pty.kill).toHaveBeenCalledTimes(1);
    expect(session.text()).toContain('"type":"ready"');
  });

  it("fails closed on a second open frame", async () => {
    const session = harness();
    session.send({ v: 1, type: "open", cols: 80, rows: 24 });
    session.send({ v: 1, type: "open", cols: 80, rows: 24 });
    await session.done;

    expect(session.create).toHaveBeenCalledTimes(1);
    expect(session.pty.kill).toHaveBeenCalledTimes(1);
    expect(session.text()).toContain('"code":"PROTOCOL_ERROR"');
  });

  it("frames PTY output and reports normal PTY exit without re-killing it", async () => {
    const session = harness();
    session.send({ v: 1, type: "open", cols: 80, rows: 24 });
    session.pty.emitData("hello 🧪\r\n");
    session.pty.emitExit(0);
    await session.done;

    expect(session.text()).toContain('"type":"output"');
    expect(session.text()).toContain("hello 🧪");
    expect(session.text()).toContain('"type":"exit","code":0,"signal":null');
    expect(session.pty.kill).not.toHaveBeenCalled();
  });

  it("kills and reports overflow before chunking an oversized PTY callback", async () => {
    const session = harness();
    session.send({ v: 1, type: "open", cols: 80, rows: 24 });
    session.pty.emitData("x".repeat(TERMINAL_LOCAL_MAX_OUTPUT_EVENT_BYTES + 1));
    await session.done;

    expect(session.pty.kill).toHaveBeenCalledTimes(1);
    expect(session.text()).toContain('"code":"OUTPUT_OVERFLOW"');
  });

  it("kills a live session after idle expiry, while accepted input refreshes only idle time", async () => {
    vi.useFakeTimers();
    const session = harness();
    session.send({ v: 1, type: "open", cols: 80, rows: 24 });

    await vi.advanceTimersByTimeAsync(TERMINAL_LOCAL_IDLE_TIMEOUT_MS - 1_000);
    session.send({ v: 1, type: "input", data: "echo ok\r" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(session.pty.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(TERMINAL_LOCAL_IDLE_TIMEOUT_MS);
    await session.done;
    expect(session.pty.kill).toHaveBeenCalledTimes(1);
    expect(session.text()).toContain('"code":"SESSION_EXPIRED"');
  });

  it("keeps the absolute deadline independent from idle refresh", async () => {
    vi.useFakeTimers();
    const session = harness();
    session.send({ v: 1, type: "open", cols: 80, rows: 24 });

    for (let index = 0; index < 7; index += 1) {
      await vi.advanceTimersByTimeAsync(4 * 60_000);
      session.send({ v: 1, type: "input", data: "\r" });
    }
    await vi.advanceTimersByTimeAsync(TERMINAL_LOCAL_ABSOLUTE_TIMEOUT_MS - 28 * 60_000);
    await session.done;

    expect(session.pty.kill).toHaveBeenCalledTimes(1);
    expect(session.text()).toContain('"code":"SESSION_EXPIRED"');
  });

  it("kills the PTY when the local socket input reaches EOF", async () => {
    const session = harness();
    session.send({ v: 1, type: "open", cols: 80, rows: 24 });
    session.input.end();
    await session.done;

    expect(session.pty.kill).toHaveBeenCalledTimes(1);
  });
});
