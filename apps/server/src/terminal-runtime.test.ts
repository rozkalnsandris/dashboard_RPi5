import { describe, expect, it, vi } from "vitest";

import {
  TERMINAL_EXPECTED_ORIGIN,
  TerminalSessionRegistry,
} from "./terminal-session-security.js";
import { createDefaultTerminalRuntime } from "./terminal-runtime.js";
import {
  TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL,
  TERMINAL_WEBSOCKET_SESSION_PROTOCOL_PREFIX,
} from "./terminal-websocket-protocol.js";

const ACCESS_ASSERTION = "opaque-access-assertion";
const TOKEN_A = "a".repeat(64);

const enabledEnv = {
  DASHBOARD_TERMINAL_ENABLED: "enabled",
  DASHBOARD_TERMINAL_ACCESS_TEAM: "example-team",
  DASHBOARD_TERMINAL_ACCESS_AUD: "example-audience",
  DASHBOARD_TERMINAL_OWNER_EMAIL: "owner@example.test",
} as NodeJS.ProcessEnv;

describe("default terminal runtime", () => {
  it("stays unavailable without exact activation and does not build an Access verifier", async () => {
    const ownerAuthVerifierFactory = vi.fn();
    const runtime = createDefaultTerminalRuntime({}, { ownerAuthVerifierFactory });

    expect(runtime.terminalEnabled).toBe(false);
    expect(ownerAuthVerifierFactory).not.toHaveBeenCalled();
    await expect(
      runtime.sessionAdmission({
        origin: TERMINAL_EXPECTED_ORIGIN,
        accessAssertion: ACCESS_ASSERTION,
      }),
    ).resolves.toEqual({ status: "TERMINAL_UNAVAILABLE" });
    await expect(
      runtime.websocketAdmission({
        origin: TERMINAL_EXPECTED_ORIGIN,
        accessAssertion: ACCESS_ASSERTION,
        protocolHeader: undefined,
      }),
    ).resolves.toEqual({ status: "TERMINAL_UNAVAILABLE" });
  });

  it("shares one registry and one owner-auth verifier between HTTP mint and WebSocket claim", async () => {
    const registry = new TerminalSessionRegistry({ tokenFactory: () => TOKEN_A });
    const verifyAssertion = vi.fn(async () => ({
      verified: true as const,
      identity: {
        email: "owner@example.test",
        subject: "owner-subject",
      },
    }));
    const ownerAuthVerifierFactory = vi.fn(() => ({ verifyAssertion }));
    const runtime = createDefaultTerminalRuntime(enabledEnv, {
      sessionRegistry: registry,
      ownerAuthVerifierFactory,
    });

    expect(runtime.terminalEnabled).toBe(true);
    expect(runtime.sessionRegistry).toBe(registry);
    expect(ownerAuthVerifierFactory).toHaveBeenCalledTimes(1);

    await expect(
      runtime.sessionAdmission({
        origin: TERMINAL_EXPECTED_ORIGIN,
        accessAssertion: ACCESS_ASSERTION,
      }),
    ).resolves.toEqual({
      status: "CREATED",
      sessionToken: TOKEN_A,
      idleTimeoutMs: 5 * 60 * 1000,
      maxLifetimeMs: 30 * 60 * 1000,
    });

    await expect(
      runtime.websocketAdmission({
        origin: TERMINAL_EXPECTED_ORIGIN,
        accessAssertion: ACCESS_ASSERTION,
        protocolHeader: `${TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL}, ${TERMINAL_WEBSOCKET_SESSION_PROTOCOL_PREFIX}${TOKEN_A}`,
      }),
    ).resolves.toEqual({ status: "ALLOWED", sessionToken: TOKEN_A });

    expect(verifyAssertion).toHaveBeenCalledTimes(2);
  });
});
