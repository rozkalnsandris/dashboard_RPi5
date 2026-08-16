import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  parseTerminalLocalServerFrame,
  serializeTerminalLocalCloseFrame,
  serializeTerminalLocalInputFrame,
  serializeTerminalLocalOpenFrame,
  serializeTerminalLocalResizeFrame,
  TerminalLocalServerLineDecoder,
  TerminalLocalWireError,
  TERMINAL_LOCAL_OUTPUT_CHUNK_MAX_BYTES,
  TERMINAL_LOCAL_READ_EVENT_MAX_BYTES,
} from "./terminal-local-wire.js";

describe("terminal local wire contract", () => {
  it("serializes only fixed versioned local client frames", () => {
    expect(serializeTerminalLocalOpenFrame()).toBe(
      '{"v":1,"type":"open","cols":80,"rows":24}\n',
    );
    expect(serializeTerminalLocalInputFrame("pwd\r")).toBe(
      '{"v":1,"type":"input","data":"pwd\\r"}\n',
    );
    expect(serializeTerminalLocalResizeFrame(120, 40)).toBe(
      '{"v":1,"type":"resize","cols":120,"rows":40}\n',
    );
    expect(serializeTerminalLocalCloseFrame()).toBe('{"v":1,"type":"close"}\n');
  });

  it("rejects local client values outside the browser/local contract", () => {
    expect(() => serializeTerminalLocalInputFrame("a\0b")).toThrow(TerminalLocalWireError);
    expect(() => serializeTerminalLocalResizeFrame(1, 24)).toThrow(TerminalLocalWireError);
    expect(() => serializeTerminalLocalResizeFrame(80, 201)).toThrow(TerminalLocalWireError);
  });

  it("parses exact local server frame shapes", () => {
    expect(parseTerminalLocalServerFrame(Buffer.from('{"v":1,"type":"ready"}'))).toEqual({
      v: 1,
      type: "ready",
    });
    expect(
      parseTerminalLocalServerFrame(
        Buffer.from('{"v":1,"type":"output","data":"hello 🧪"}'),
      ),
    ).toEqual({ v: 1, type: "output", data: "hello 🧪" });
    expect(
      parseTerminalLocalServerFrame(
        Buffer.from('{"v":1,"type":"exit","code":0,"signal":null}'),
      ),
    ).toEqual({ v: 1, type: "exit", code: 0, signal: null });
    expect(
      parseTerminalLocalServerFrame(
        Buffer.from('{"v":1,"type":"error","code":"SESSION_EXPIRED"}'),
      ),
    ).toEqual({ v: 1, type: "error", code: "SESSION_EXPIRED" });
  });

  it("rejects malformed, oversized and widened local server frames", () => {
    for (const frame of [
      '{"v":2,"type":"ready"}',
      '{"v":1,"type":"ready","extra":true}',
      '{"v":1,"type":"output","data":""}',
      '{"v":1,"type":"exit","code":-1,"signal":null}',
      '{"v":1,"type":"error","code":"ROOT_ME"}',
      "not-json",
    ]) {
      expect(() => parseTerminalLocalServerFrame(Buffer.from(frame))).toThrow(
        TerminalLocalWireError,
      );
    }

    const oversizedOutput = JSON.stringify({
      v: 1,
      type: "output",
      data: "x".repeat(TERMINAL_LOCAL_OUTPUT_CHUNK_MAX_BYTES + 1),
    });
    expect(() => parseTerminalLocalServerFrame(Buffer.from(oversizedOutput))).toThrow(
      TerminalLocalWireError,
    );
    expect(() => parseTerminalLocalServerFrame(Buffer.from([0xff, 0xfe]))).toThrow(
      TerminalLocalWireError,
    );
  });

  it("decodes split and coalesced NDJSON with bounded pending input", () => {
    const decoder = new TerminalLocalServerLineDecoder();
    expect(decoder.push(Buffer.from('{"v":1,"type":"rea'))).toEqual([]);
    expect(
      decoder.push(
        Buffer.from(
          'dy"}\n{"v":1,"type":"output","data":"ok"}\n',
        ),
      ),
    ).toEqual([
      { v: 1, type: "ready" },
      { v: 1, type: "output", data: "ok" },
    ]);
    expect(() => decoder.end()).not.toThrow();

    const oversized = new TerminalLocalServerLineDecoder();
    expect(() => oversized.push(Buffer.alloc(TERMINAL_LOCAL_READ_EVENT_MAX_BYTES + 1))).toThrow(
      TerminalLocalWireError,
    );
  });
});
