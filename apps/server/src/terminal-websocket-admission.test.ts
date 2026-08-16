import { describe, expect, it, vi } from "vitest";

import type { OwnerAuthVerifier } from "./terminal-session-admission.js";
import {
  TERMINAL_EXPECTED_ORIGIN,
  TerminalSessionRegistry,
} from "./terminal-session-security.js";
import { createTerminalWebSocketAdmission } from "./terminal-websocket-admission.js";
import {
  TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL,
  TERMINAL_WEBSOCKET_SESSION_PROTOCOL_PREFIX,
} from "./terminal-websocket-protocol.js";

const TOKEN_A = "a".repeat(64);
const ACCESS_ASSERTION = "opaque-access-assertion";

function protocolHeader(token = TOKEN_A): string {
  return `${TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL}, ${TERMINAL_WEBSOCKET_SESSION_PROTOCOL_PREFIX}${token}`;
}

function verifiedOwnerAuthVerifier(): OwnerAuthVerifier {
  return {
    async verifyAssertion() {
      return {
        verified: true,
        identity: {
          email: "owner@example.test",
          subject: "owner-subject",
        },
      };
    },
  };
}

function createLiveRegistry(): TerminalSessionRegistry {
  const registry = new TerminalSessionRegistry({ tokenFactory: () => TOKEN_A });
  const created = registry.createSession({
    terminalEnabled: true,
    ownerAuthVerified: true,
    origin: TERMINAL_EXPECTED_ORIGIN,
  });
  if (!created.created) {
    throw new Error("Expected terminal session fixture to be created");
  }
  return registry;
}

const validInput = {
  origin: TERMINAL_EXPECTED_ORIGIN,
  accessAssertion: ACCESS_ASSERTION,
  protocolHeader: protocolHeader(),
} as const;

describe("terminal WebSocket admission", () => {
  it("fails closed while terminal activation is disabled without requiring an auth verifier", async () => {
    const registry = new TerminalSessionRegistry({ tokenFactory: () => TOKEN_A });
    const admission = createTerminalWebSocketAdmission({
      terminalEnabled: false,
      sessionRegistry: registry,
    });

    await expect(admission(validInput)).resolves.toEqual({
      status: "TERMINAL_UNAVAILABLE",
    });
  });

  it("refuses to construct an enabled admission boundary without owner auth", () => {
    const registry = new TerminalSessionRegistry({ tokenFactory: () => TOKEN_A });
    expect(() =>
      createTerminalWebSocketAdmission({
        terminalEnabled: true,
        sessionRegistry: registry,
      }),
    ).toThrow("Enabled terminal WebSocket admission requires an owner-auth verifier");
  });

  it("re-verifies owner identity before exact Origin and capability claim", async () => {
    const registry = createLiveRegistry();
    const verifyAssertion = vi.fn(async () => ({
      verified: true as const,
      identity: {
        email: "owner@example.test",
        subject: "owner-subject",
      },
    }));
    const admission = createTerminalWebSocketAdmission({
      terminalEnabled: true,
      sessionRegistry: registry,
      ownerAuthVerifier: { verifyAssertion },
    });

    await expect(
      admission({
        ...validInput,
        origin: "https://dash.rozkalns.net.evil.example",
      }),
    ).resolves.toEqual({ status: "ADMISSION_DENIED" });
    expect(verifyAssertion).toHaveBeenCalledWith(ACCESS_ASSERTION);

    await expect(admission(validInput)).resolves.toEqual({
      status: "ALLOWED",
      sessionToken: TOKEN_A,
    });
  });

  it("does not touch capability state when the protocol header is malformed", async () => {
    const registry = createLiveRegistry();
    const admission = createTerminalWebSocketAdmission({
      terminalEnabled: true,
      sessionRegistry: registry,
      ownerAuthVerifier: verifiedOwnerAuthVerifier(),
    });

    await expect(
      admission({
        ...validInput,
        protocolHeader: `${TERMINAL_WEBSOCKET_APPLICATION_PROTOCOL}, session.NOT-A-TOKEN`,
      }),
    ).resolves.toEqual({ status: "ADMISSION_DENIED" });

    await expect(admission(validInput)).resolves.toEqual({
      status: "ALLOWED",
      sessionToken: TOKEN_A,
    });
  });

  it("collapses unknown, expired and replayed capabilities into the same denial", async () => {
    let now = 1_000;
    const registry = new TerminalSessionRegistry({
      now: () => now,
      tokenFactory: () => TOKEN_A,
    });
    const created = registry.createSession({
      terminalEnabled: true,
      ownerAuthVerified: true,
      origin: TERMINAL_EXPECTED_ORIGIN,
    });
    expect(created.created).toBe(true);

    const admission = createTerminalWebSocketAdmission({
      terminalEnabled: true,
      sessionRegistry: registry,
      ownerAuthVerifier: verifiedOwnerAuthVerifier(),
    });

    await expect(
      admission({ ...validInput, protocolHeader: protocolHeader("b".repeat(64)) }),
    ).resolves.toEqual({ status: "ADMISSION_DENIED" });

    await expect(admission(validInput)).resolves.toEqual({
      status: "ALLOWED",
      sessionToken: TOKEN_A,
    });
    await expect(admission(validInput)).resolves.toEqual({ status: "ADMISSION_DENIED" });

    registry.revoke(TOKEN_A);
    const replacement = registry.createSession({
      terminalEnabled: true,
      ownerAuthVerified: true,
      origin: TERMINAL_EXPECTED_ORIGIN,
    });
    expect(replacement.created).toBe(true);
    now += 5 * 60 * 1000;
    await expect(admission(validInput)).resolves.toEqual({ status: "ADMISSION_DENIED" });
  });

  it("maps signing-key unavailability and verifier exceptions to auth unavailable", async () => {
    const registry = createLiveRegistry();
    const keyUnavailable = createTerminalWebSocketAdmission({
      terminalEnabled: true,
      sessionRegistry: registry,
      ownerAuthVerifier: {
        async verifyAssertion() {
          return { verified: false, reason: "KEY_UNAVAILABLE" };
        },
      },
    });
    await expect(keyUnavailable(validInput)).resolves.toEqual({ status: "AUTH_UNAVAILABLE" });

    const verifierFailure = createTerminalWebSocketAdmission({
      terminalEnabled: true,
      sessionRegistry: registry,
      ownerAuthVerifier: {
        async verifyAssertion() {
          throw new Error("fixture verifier failure");
        },
      },
    });
    await expect(verifierFailure(validInput)).resolves.toEqual({ status: "AUTH_UNAVAILABLE" });
  });

  it("rejects non-owner auth without revealing capability state", async () => {
    const registry = createLiveRegistry();
    const admission = createTerminalWebSocketAdmission({
      terminalEnabled: true,
      sessionRegistry: registry,
      ownerAuthVerifier: {
        async verifyAssertion() {
          return { verified: false, reason: "OWNER_MISMATCH" };
        },
      },
    });

    await expect(admission(validInput)).resolves.toEqual({ status: "ADMISSION_DENIED" });
    expect(registry.activeCount()).toBe(1);
  });
});
