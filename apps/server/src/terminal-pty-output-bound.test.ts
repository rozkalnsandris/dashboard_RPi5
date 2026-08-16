import { describe, expect, it, vi } from "vitest";

import { TERMINAL_OUTPUT_EVENT_MAX_BYTES } from "./terminal-application-protocol.js";
import {
  attachTerminalPtyLifecycle,
  type TerminalPtyFactory,
} from "./terminal-pty-lifecycle.js";
import {
  TERMINAL_EXPECTED_ORIGIN,
  TerminalSessionRegistry,
} from "./terminal-session-security.js";

const TOKEN = "c".repeat(64);

describe("terminal PTY output event bound", () => {
  it("kills before chunking an oversized adapter output callback", () => {
    const registry = new TerminalSessionRegistry({ tokenFactory: () => TOKEN });
    expect(
      registry.createSession({
        terminalEnabled: true,
        ownerAuthVerified: true,
        origin: TERMINAL_EXPECTED_ORIGIN,
      }).created,
    ).toBe(true);
    expect(
      registry.claimTransport({
        terminalEnabled: true,
        ownerAuthVerified: true,
        origin: TERMINAL_EXPECTED_ORIGIN,
        sessionToken: TOKEN,
      }).claimed,
    ).toBe(true);

    let dataListener: ((data: string) => void) | undefined;
    const kill = vi.fn();
    const ptyFactory: TerminalPtyFactory = {
      create() {
        return {
          write() {},
          resize() {},
          kill,
          onData(listener) {
            dataListener = listener;
            return { dispose: () => (dataListener = undefined) };
          },
          onExit() {
            return { dispose() {} };
          },
        };
      },
    };

    const sent: string[] = [];
    const closes: Array<{ code: number; reason: string }> = [];
    const attached = attachTerminalPtyLifecycle({
      sessionRegistry: registry,
      sessionToken: TOKEN,
      ptyFactory,
      socket: {
        bufferedAmount: 0,
        send(data) {
          sent.push(data);
        },
        close(code, reason) {
          closes.push({ code, reason });
        },
      },
    });
    expect(attached.attached).toBe(true);

    dataListener?.("a".repeat(TERMINAL_OUTPUT_EVENT_MAX_BYTES + 1));

    expect(kill).toHaveBeenCalledTimes(1);
    expect(registry.activeCount()).toBe(0);
    expect(sent).toEqual(['{"type":"ready"}']);
    expect(closes).toEqual([{ code: 1013, reason: "TERMINAL_OUTPUT_OVERLOAD" }]);
  });
});
