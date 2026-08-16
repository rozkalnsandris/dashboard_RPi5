import { describe, expect, it, vi } from "vitest";

import {
  attachTerminalPtyLifecycle,
  type TerminalPtyFactory,
} from "./terminal-pty-lifecycle.js";
import {
  TERMINAL_EXPECTED_ORIGIN,
  TerminalSessionRegistry,
} from "./terminal-session-security.js";

const TOKEN = "b".repeat(64);

describe("terminal PTY claimed-transport invariant", () => {
  it("never constructs a PTY for a minted but unclaimed session token", () => {
    const registry = new TerminalSessionRegistry({ tokenFactory: () => TOKEN });
    const created = registry.createSession({
      terminalEnabled: true,
      ownerAuthVerified: true,
      origin: TERMINAL_EXPECTED_ORIGIN,
    });
    expect(created.created).toBe(true);

    const create = vi.fn();
    const ptyFactory: TerminalPtyFactory = { create };
    const result = attachTerminalPtyLifecycle({
      sessionRegistry: registry,
      sessionToken: TOKEN,
      ptyFactory,
      socket: {
        bufferedAmount: 0,
        send() {},
        close() {},
      },
    });

    expect(result).toEqual({ attached: false, reason: "SESSION_NOT_LIVE" });
    expect(create).not.toHaveBeenCalled();
    expect(registry.activeCount()).toBe(1);
  });
});
