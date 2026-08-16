import type {
  CloudflareAccessOwnerAuthOptions,
  CloudflareAccessOwnerAuthResult,
} from "./cloudflare-access-owner-auth.js";
import {
  createDefaultTerminalSessionAdmission,
  createTerminalSessionAdmission,
  type OwnerAuthVerifier,
} from "./terminal-session-admission.js";
import {
  TERMINAL_EXPECTED_ORIGIN,
  TERMINAL_IDLE_TIMEOUT_MS,
  TERMINAL_MAX_LIFETIME_MS,
  TerminalSessionRegistry,
} from "./terminal-session-security.js";
import { describe, expect, it, vi } from "vitest";

const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const ASSERTION = "header.payload.signature";

function verifierReturning(result: CloudflareAccessOwnerAuthResult): OwnerAuthVerifier {
  return {
    verifyAssertion: vi.fn(async () => result),
  };
}

function verifiedVerifier(): OwnerAuthVerifier {
  return verifierReturning({
    verified: true,
    identity: {
      email: "owner@example.com",
      subject: "owner-subject",
    },
  });
}

describe("terminal session admission", () => {
  it("stays unavailable without exact runtime activation and never constructs Access auth", async () => {
    const verifierFactory = vi.fn(
      (_options: CloudflareAccessOwnerAuthOptions): OwnerAuthVerifier => verifiedVerifier(),
    );
    const admission = createDefaultTerminalSessionAdmission(
      {
        DASHBOARD_TERMINAL_ENABLED: "true",
        DASHBOARD_TERMINAL_ACCESS_TEAM: "dashboard-owner",
        DASHBOARD_TERMINAL_ACCESS_AUD: "audience",
        DASHBOARD_TERMINAL_OWNER_EMAIL: "owner@example.com",
      },
      { ownerAuthVerifierFactory: verifierFactory },
    );

    await expect(
      admission({
        origin: TERMINAL_EXPECTED_ORIGIN,
        accessAssertion: ASSERTION,
      }),
    ).resolves.toEqual({ status: "TERMINAL_UNAVAILABLE" });
    expect(verifierFactory).not.toHaveBeenCalled();
  });

  it("fails closed when explicitly enabled without complete Access configuration", () => {
    expect(() =>
      createDefaultTerminalSessionAdmission({
        DASHBOARD_TERMINAL_ENABLED: "enabled",
      }),
    ).toThrow("DASHBOARD_TERMINAL_ACCESS_TEAM");
  });

  it("creates one opaque bounded session for a verified owner and exact Origin", async () => {
    const registry = new TerminalSessionRegistry({
      now: () => 1_000,
      tokenFactory: () => TOKEN_A,
    });
    const verifier = verifiedVerifier();
    const admission = createTerminalSessionAdmission({
      terminalEnabled: true,
      ownerAuthVerifier: verifier,
      sessionRegistry: registry,
    });

    await expect(
      admission({
        origin: TERMINAL_EXPECTED_ORIGIN,
        accessAssertion: ASSERTION,
      }),
    ).resolves.toEqual({
      status: "CREATED",
      sessionToken: TOKEN_A,
      idleTimeoutMs: TERMINAL_IDLE_TIMEOUT_MS,
      maxLifetimeMs: TERMINAL_MAX_LIFETIME_MS,
    });
    expect(verifier.verifyAssertion).toHaveBeenCalledWith(ASSERTION);
    expect(registry.activeCount()).toBe(1);
  });

  it("rejects missing or invalid owner auth without allocating a session", async () => {
    const registry = new TerminalSessionRegistry({
      tokenFactory: () => TOKEN_A,
    });
    const verifier = verifierReturning({
      verified: false,
      reason: "TOKEN_MISSING",
    });
    const admission = createTerminalSessionAdmission({
      terminalEnabled: true,
      ownerAuthVerifier: verifier,
      sessionRegistry: registry,
    });

    await expect(
      admission({
        origin: TERMINAL_EXPECTED_ORIGIN,
        accessAssertion: undefined,
      }),
    ).resolves.toEqual({ status: "ADMISSION_DENIED" });
    expect(registry.activeCount()).toBe(0);
  });

  it("maps Access signing-key availability failure without returning token details", async () => {
    const verifier = verifierReturning({
      verified: false,
      reason: "KEY_UNAVAILABLE",
    });
    const admission = createTerminalSessionAdmission({
      terminalEnabled: true,
      ownerAuthVerifier: verifier,
    });

    await expect(
      admission({
        origin: TERMINAL_EXPECTED_ORIGIN,
        accessAssertion: ASSERTION,
      }),
    ).resolves.toEqual({ status: "AUTH_UNAVAILABLE" });
  });

  it("requires the exact production Origin after owner authentication", async () => {
    const registry = new TerminalSessionRegistry({
      tokenFactory: () => TOKEN_A,
    });
    const admission = createTerminalSessionAdmission({
      terminalEnabled: true,
      ownerAuthVerifier: verifiedVerifier(),
      sessionRegistry: registry,
    });

    await expect(
      admission({
        origin: "https://dash.rozkalns.net.evil.example",
        accessAssertion: ASSERTION,
      }),
    ).resolves.toEqual({ status: "ADMISSION_DENIED" });
    expect(registry.activeCount()).toBe(0);
  });

  it("enforces the one-session beta concurrency limit", async () => {
    let token = TOKEN_A;
    const registry = new TerminalSessionRegistry({
      now: () => 10_000,
      tokenFactory: () => token,
    });
    const admission = createTerminalSessionAdmission({
      terminalEnabled: true,
      ownerAuthVerifier: verifiedVerifier(),
      sessionRegistry: registry,
    });

    await expect(
      admission({
        origin: TERMINAL_EXPECTED_ORIGIN,
        accessAssertion: ASSERTION,
      }),
    ).resolves.toMatchObject({ status: "CREATED", sessionToken: TOKEN_A });

    token = TOKEN_B;
    await expect(
      admission({
        origin: TERMINAL_EXPECTED_ORIGIN,
        accessAssertion: ASSERTION,
      }),
    ).resolves.toEqual({ status: "SESSION_LIMIT" });
    expect(registry.activeCount()).toBe(1);
  });

  it("fails closed when the verifier throws unexpectedly", async () => {
    const verifier: OwnerAuthVerifier = {
      verifyAssertion: vi.fn(async () => {
        throw new Error("unexpected verifier failure");
      }),
    };
    const admission = createTerminalSessionAdmission({
      terminalEnabled: true,
      ownerAuthVerifier: verifier,
    });

    await expect(
      admission({
        origin: TERMINAL_EXPECTED_ORIGIN,
        accessAssertion: ASSERTION,
      }),
    ).resolves.toEqual({ status: "AUTH_UNAVAILABLE" });
  });
});
