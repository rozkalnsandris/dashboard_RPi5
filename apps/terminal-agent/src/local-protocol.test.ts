import { describe, expect, it } from "vitest";

import {
  parseTerminalLocalClientFrame,
  splitTerminalLocalOutput,
  TerminalLocalLineDecoder,
  TerminalLocalProtocolError,
  TERMINAL_LOCAL_MAX_FRAME_BYTES,
  TERMINAL_LOCAL_MAX_INPUT_BYTES,
  TERMINAL_LOCAL_MAX_OUTPUT_CHUNK_BYTES,
  TERMINAL_LOCAL_MAX_OUTPUT_EVENT_BYTES,
} from "./local-protocol.js";

const frame = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8");

describe("terminal local protocol", () => {
  it("accepts only exact open/input/resize/close frame shapes", () => {
    expect(parseTerminalLocalClientFrame(frame({ v: 1, type: "open", cols: 80, rows: 24 }))).toEqual({
      v: 1,
      type: "open",
      cols: 80,
      rows: 24,
    });
    expect(parseTerminalLocalClientFrame(frame({ v: 1, type: "input", data: "pwd\r" }))).toEqual({
      v: 1,
      type: "input",
      data: "pwd\r",
    });
    expect(parseTerminalLocalClientFrame(frame({ v: 1, type: "resize", cols: 120, rows: 40 }))).toEqual({
      v: 1,
      type: "resize",
      cols: 120,
      rows: 40,
    });
    expect(parseTerminalLocalClientFrame(frame({ v: 1, type: "close" }))).toEqual({
      v: 1,
      type: "close",
    });
  });

  it("rejects unknown versions, extra fields, invalid dimensions and unexpected types", () => {
    for (const value of [
      { v: 2, type: "open", cols: 80, rows: 24 },
      { v: 1, type: "open", cols: 80, rows: 24, command: "bash" },
      { v: 1, type: "open", cols: 1, rows: 24 },
      { v: 1, type: "resize", cols: 80, rows: 201 },
      { v: 1, type: "exec", command: "id" },
      { v: 1, type: "close", reason: "later" },
      [],
      null,
    ]) {
      expect(() => parseTerminalLocalClientFrame(frame(value))).toThrow(TerminalLocalProtocolError);
    }
  });

  it("bounds UTF-8 input and rejects NUL", () => {
    expect(() =>
      parseTerminalLocalClientFrame(
        frame({ v: 1, type: "input", data: "x".repeat(TERMINAL_LOCAL_MAX_INPUT_BYTES + 1) }),
      ),
    ).toThrow(TerminalLocalProtocolError);
    expect(() => parseTerminalLocalClientFrame(frame({ v: 1, type: "input", data: "a\0b" }))).toThrow(
      TerminalLocalProtocolError,
    );
    expect(() => parseTerminalLocalClientFrame(frame({ v: 1, type: "input", data: "" }))).toThrow(
      TerminalLocalProtocolError,
    );
  });

  it("rejects malformed UTF-8 and oversized raw frames", () => {
    expect(() => parseTerminalLocalClientFrame(Uint8Array.from([0xc3, 0x28]))).toThrow(
      TerminalLocalProtocolError,
    );
    expect(() => parseTerminalLocalClientFrame(Buffer.alloc(TERMINAL_LOCAL_MAX_FRAME_BYTES + 1, 0x61))).toThrow(
      TerminalLocalProtocolError,
    );
  });

  it("decodes only newline-terminated bounded frames", () => {
    const decoder = new TerminalLocalLineDecoder();
    const first = Buffer.from('{"v":1,"type":"close"}\n{"v":1,', "utf8");
    const second = Buffer.from('"type":"close"}\n', "utf8");

    expect(decoder.push(first).map((value) => Buffer.from(value).toString("utf8"))).toEqual([
      '{"v":1,"type":"close"}',
    ]);
    expect(decoder.push(second).map((value) => Buffer.from(value).toString("utf8"))).toEqual([
      '{"v":1,"type":"close"}',
    ]);
    expect(() => decoder.end()).not.toThrow();

    const partial = new TerminalLocalLineDecoder();
    partial.push(Buffer.from("{", "utf8"));
    expect(() => partial.end()).toThrow(TerminalLocalProtocolError);
  });

  it("chunks Unicode output without exceeding byte bounds and rejects oversized events", () => {
    const data = "🧪".repeat(1500);
    const chunks = splitTerminalLocalOutput(data);
    expect(chunks.join("")).toBe(data);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => Buffer.byteLength(chunk, "utf8") <= TERMINAL_LOCAL_MAX_OUTPUT_CHUNK_BYTES)).toBe(
      true,
    );

    expect(() => splitTerminalLocalOutput("x".repeat(TERMINAL_LOCAL_MAX_OUTPUT_EVENT_BYTES + 1))).toThrow(
      TerminalLocalProtocolError,
    );
  });
});
