import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  parseTerminalClientMessage,
  serializeTerminalExitFrame,
  serializeTerminalOutputFrame,
  serializeTerminalReadyFrame,
  splitTerminalOutput,
  TERMINAL_INPUT_MAX_BYTES,
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
  TERMINAL_OUTPUT_FRAME_MAX_BYTES,
} from "./terminal-application-protocol.js";

describe("terminal application protocol", () => {
  it("accepts only the exact input message shape", () => {
    expect(parseTerminalClientMessage(JSON.stringify({ type: "input", data: "ls\r" }))).toEqual({
      parsed: true,
      message: { type: "input", data: "ls\r" },
    });

    for (const frame of [
      JSON.stringify({ type: "input", data: "" }),
      JSON.stringify({ type: "input", data: "x", extra: true }),
      JSON.stringify({ type: "input", data: 1 }),
      JSON.stringify({ type: "paste", data: "x" }),
      JSON.stringify(["input", "x"]),
      "not-json",
    ]) {
      expect(parseTerminalClientMessage(frame).parsed).toBe(false);
    }
  });

  it("bounds input by UTF-8 bytes rather than JavaScript code units", () => {
    expect(
      parseTerminalClientMessage(
        JSON.stringify({ type: "input", data: "a".repeat(TERMINAL_INPUT_MAX_BYTES) }),
      ).parsed,
    ).toBe(true);
    expect(
      parseTerminalClientMessage(
        JSON.stringify({ type: "input", data: "😀".repeat(TERMINAL_INPUT_MAX_BYTES / 4 + 1) }),
      ),
    ).toEqual({ parsed: false, reason: "INPUT_TOO_LARGE" });
  });

  it("accepts only bounded integer resize dimensions with no extra fields", () => {
    for (const [cols, rows] of [
      [TERMINAL_MIN_COLS, TERMINAL_MIN_ROWS],
      [80, 24],
      [TERMINAL_MAX_COLS, TERMINAL_MAX_ROWS],
    ]) {
      expect(parseTerminalClientMessage(JSON.stringify({ type: "resize", cols, rows }))).toEqual({
        parsed: true,
        message: { type: "resize", cols, rows },
      });
    }

    for (const value of [
      { type: "resize", cols: TERMINAL_MIN_COLS - 1, rows: 24 },
      { type: "resize", cols: 80, rows: TERMINAL_MAX_ROWS + 1 },
      { type: "resize", cols: 80.5, rows: 24 },
      { type: "resize", cols: 80, rows: 24, extra: true },
    ]) {
      expect(parseTerminalClientMessage(JSON.stringify(value)).parsed).toBe(false);
    }
  });

  it("serializes only fixed server frame shapes", () => {
    expect(serializeTerminalReadyFrame()).toBe('{"type":"ready"}');
    expect(serializeTerminalOutputFrame("ok\r\n")).toBe(
      '{"type":"output","data":"ok\\r\\n"}',
    );
    expect(serializeTerminalExitFrame({ exitCode: 0 })).toBe(
      '{"type":"exit","exitCode":0}',
    );
    expect(serializeTerminalExitFrame({ exitCode: 2, signal: 15 })).toBe(
      '{"type":"exit","exitCode":2,"signal":15}',
    );
    expect(serializeTerminalExitFrame({ exitCode: Number.NaN, signal: -1 })).toBe(
      '{"type":"exit","exitCode":0,"signal":0}',
    );
  });

  it("chunks output on Unicode code-point boundaries within the byte limit", () => {
    const data = `${"a".repeat(TERMINAL_OUTPUT_FRAME_MAX_BYTES - 2)}😀tail`;
    const chunks = splitTerminalOutput(data);

    expect(chunks.join("")).toBe(data);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, "utf8")).toBeLessThanOrEqual(
        TERMINAL_OUTPUT_FRAME_MAX_BYTES,
      );
    }
    expect(splitTerminalOutput("")).toEqual([]);
  });
});
