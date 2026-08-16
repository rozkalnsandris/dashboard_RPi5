import { describe, expect, it } from "vitest";

import {
  evaluateTerminalAdmission,
  isTerminalExplicitlyEnabled,
  isTerminalSessionToken,
  TERMINAL_EXPECTED_ORIGIN,
  TERMINAL_IDLE_TIMEOUT_MS,
  TERMINAL_MAX_LIFETIME_MS,
  TerminalSessionRegistry,
} from "./terminal-session-security.js";

const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);

const admittedInput = {
  terminalEnabled: true,
  ownerAuthVerified: true,
  origin: TERMINAL_EXPECTED_ORIGIN,
} as const;

const transportClaimInput = {
  ...admittedInput,
  sessionToken: TOKEN_A,
} as const;

describe("terminal activation", () => {
  it("enables only the exact reviewed value", () => {
    expect(isTerminalExplicitlyEnabled("enabled")).toBe(true);
    for (const value of [undefined, "", "true", "1", "yes", "Enabled", " enabled", "enabled "]) {
      expect(isTerminalExplicitlyEnabled(value)).toBe(false);
    }
  });
});

describe("terminal session token shape", () => {
  it("accepts only 256-bit lowercase hex tokens", () => {
    expect(isTerminalSessionToken(TOKEN_A)).toBe(true);
    for (const value of [
      "",
      "a".repeat(63),
      "a".repeat(65),
      "A".repeat(64),
      `${"a".repeat(63)}g`,
      "browser-controlled-token",
    ]) {
      expect(isTerminalSessionToken(value)).toBe(false);
    }
  });
});

describe("terminal admission", () => {
  it("fails closed until terminal runtime activation is explicit", () => {
    expect(
      evaluateTerminalAdmission({
        terminalEnabled: false,
        ownerAuthVerified: true,
        origin: TERMINAL_EXPECTED_ORIGIN,
        activeSessions: 0,
      }),
    ).toEqual({ allowed: false, reason: "TERMINAL_DISABLED" });
  });

  it("requires a separately verified owner-auth verdict", () => {
    expect(
      evaluateTerminalAdmission({
        terminalEnabled: true,
        ownerAuthVerified: false,
        origin: TERMINAL_EXPECTED_ORIGIN,
        activeSessions: 0,
      }),
    ).toEqual({ allowed: false, reason: "OWNER_AUTH_REQUIRED" });
  });

  it("requires the exact production dashboard origin", () => {
    expect(
      evaluateTerminalAdmission({
        terminalEnabled: true,
        ownerAuthVerified: true,
        origin: undefined,
        activeSessions: 0,
      }),
    ).toEqual({ allowed: false, reason: "ORIGIN_REQUIRED" });

    for (const origin of [
      "",
      "https://evil.example",
      "http://dash.rozkalns.net",
      "https://dash.rozkalns.net.evil.example",
      "https://dash.rozkalns.net/",
      "https://DASH.rozkalns.net",
    ]) {
      expect(
        evaluateTerminalAdmission({
          terminalEnabled: true,
          ownerAuthVerified: true,
          origin,
          activeSessions: 0,
        }),
      ).toEqual({ allowed: false, reason: origin === "" ? "ORIGIN_REQUIRED" : "ORIGIN_REJECTED" });
    }
  });

  it("allows only one active beta session", () => {
    expect(
      evaluateTerminalAdmission({
        terminalEnabled: true,
        ownerAuthVerified: true,
        origin: TERMINAL_EXPECTED_ORIGIN,
        activeSessions: 1,
      }),
    ).toEqual({ allowed: false, reason: "CONCURRENCY_LIMIT" });

    expect(
      evaluateTerminalAdmission({
        terminalEnabled: true,
        ownerAuthVerified: true,
        origin: TERMINAL_EXPECTED_ORIGIN,
        activeSessions: 0,
      }),
    ).toEqual({ allowed: true });
  });
});

describe("TerminalSessionRegistry", () => {
  it("creates an opaque bounded session only after admission passes", () => {
    const now = 1_000;
    const registry = new TerminalSessionRegistry({
      now: () => now,
      tokenFactory: () => TOKEN_A,
    });

    const created = registry.createSession(admittedInput);
    expect(created).toEqual({
      created: true,
      session: {
        token: TOKEN_A,
        createdAtMs: 1_000,
        lastActivityAtMs: 1_000,
        idleExpiresAtMs: 1_000 + TERMINAL_IDLE_TIMEOUT_MS,
        maxExpiresAtMs: 1_000 + TERMINAL_MAX_LIFETIME_MS,
      },
    });
    expect(registry.activeCount()).toBe(1);

    const second = registry.createSession(admittedInput);
    expect(second).toEqual({ created: false, reason: "CONCURRENCY_LIMIT" });
  });

  it("atomically claims one live session for one authenticated exact-origin transport", () => {
    let now = 2_000;
    const createdAt = now;
    const registry = new TerminalSessionRegistry({
      now: () => now,
      tokenFactory: () => TOKEN_A,
    });
    expect(registry.createSession(admittedInput).created).toBe(true);

    now += 1_000;
    expect(registry.claimTransport(transportClaimInput)).toEqual({
      claimed: true,
      session: {
        createdAtMs: createdAt,
        lastActivityAtMs: now,
        idleExpiresAtMs: now + TERMINAL_IDLE_TIMEOUT_MS,
        maxExpiresAtMs: createdAt + TERMINAL_MAX_LIFETIME_MS,
      },
    });

    now += 1_000;
    expect(registry.claimTransport(transportClaimInput)).toEqual({
      claimed: false,
      reason: "SESSION_ALREADY_CLAIMED",
    });
    expect(registry.activeCount()).toBe(1);
  });

  it("checks activation, owner auth and exact Origin before token state", () => {
    const registry = new TerminalSessionRegistry({ tokenFactory: () => TOKEN_A });
    expect(registry.createSession(admittedInput).created).toBe(true);

    expect(
      registry.claimTransport({
        terminalEnabled: false,
        ownerAuthVerified: true,
        origin: TERMINAL_EXPECTED_ORIGIN,
        sessionToken: "not-a-token",
      }),
    ).toEqual({ claimed: false, reason: "TERMINAL_DISABLED" });

    expect(
      registry.claimTransport({
        terminalEnabled: true,
        ownerAuthVerified: false,
        origin: TERMINAL_EXPECTED_ORIGIN,
        sessionToken: "not-a-token",
      }),
    ).toEqual({ claimed: false, reason: "OWNER_AUTH_REQUIRED" });

    for (const origin of [
      undefined,
      "",
      "http://dash.rozkalns.net",
      "https://dash.rozkalns.net.evil.example",
    ]) {
      expect(
        registry.claimTransport({
          terminalEnabled: true,
          ownerAuthVerified: true,
          origin,
          sessionToken: "not-a-token",
        }),
      ).toEqual({
        claimed: false,
        reason: origin === undefined || origin === "" ? "ORIGIN_REQUIRED" : "ORIGIN_REJECTED",
      });
    }
  });

  it("rejects missing, malformed and unknown transport session tokens", () => {
    const registry = new TerminalSessionRegistry({ tokenFactory: () => TOKEN_A });
    expect(registry.createSession(admittedInput).created).toBe(true);

    expect(
      registry.claimTransport({ ...admittedInput, sessionToken: undefined }),
    ).toEqual({ claimed: false, reason: "SESSION_TOKEN_REQUIRED" });
    expect(registry.claimTransport({ ...admittedInput, sessionToken: "" })).toEqual({
      claimed: false,
      reason: "SESSION_TOKEN_REQUIRED",
    });
    expect(
      registry.claimTransport({ ...admittedInput, sessionToken: "A".repeat(64) }),
    ).toEqual({ claimed: false, reason: "SESSION_TOKEN_INVALID" });
    expect(registry.claimTransport({ ...admittedInput, sessionToken: TOKEN_B })).toEqual({
      claimed: false,
      reason: "SESSION_NOT_FOUND",
    });
  });

  it("rejects expired and explicitly revoked tokens at transport claim", () => {
    let now = 10_000;
    const registry = new TerminalSessionRegistry({
      now: () => now,
      tokenFactory: () => TOKEN_A,
    });
    expect(registry.createSession(admittedInput).created).toBe(true);

    now += TERMINAL_IDLE_TIMEOUT_MS;
    expect(registry.claimTransport(transportClaimInput)).toEqual({
      claimed: false,
      reason: "SESSION_NOT_FOUND",
    });

    now += 1;
    expect(registry.createSession(admittedInput).created).toBe(true);
    expect(registry.revoke(TOKEN_A)).toBe(true);
    expect(registry.claimTransport(transportClaimInput)).toEqual({
      claimed: false,
      reason: "SESSION_NOT_FOUND",
    });
  });

  it("transport claim activity never extends the absolute maximum lifetime", () => {
    let now = 20_000;
    const createdAt = now;
    const registry = new TerminalSessionRegistry({
      now: () => now,
      tokenFactory: () => TOKEN_A,
    });
    expect(registry.createSession(admittedInput).created).toBe(true);

    for (let elapsed = 4 * 60 * 1000; elapsed < TERMINAL_MAX_LIFETIME_MS; elapsed += 4 * 60 * 1000) {
      now = createdAt + elapsed;
      expect(registry.touch(TOKEN_A)).not.toBeNull();
    }

    now = createdAt + TERMINAL_MAX_LIFETIME_MS - 1;
    const claimed = registry.claimTransport(transportClaimInput);
    expect(claimed).toMatchObject({ claimed: true });
    if (!claimed.claimed) {
      throw new Error("Expected terminal transport claim");
    }
    expect(claimed.session.maxExpiresAtMs).toBe(createdAt + TERMINAL_MAX_LIFETIME_MS);

    now = createdAt + TERMINAL_MAX_LIFETIME_MS;
    expect(registry.activeCount()).toBe(0);
    expect(registry.touch(TOKEN_A)).toBeNull();
  });

  it("expires a session exactly at the idle boundary", () => {
    let now = 30_000;
    const registry = new TerminalSessionRegistry({
      now: () => now,
      tokenFactory: () => TOKEN_A,
    });
    const created = registry.createSession(admittedInput);
    expect(created.created).toBe(true);

    now += TERMINAL_IDLE_TIMEOUT_MS - 1;
    expect(registry.activeCount()).toBe(1);

    now += 1;
    expect(registry.activeCount()).toBe(0);
    expect(registry.touch(TOKEN_A)).toBeNull();
  });

  it("never extends a session beyond the absolute maximum lifetime", () => {
    let now = 40_000;
    const createdAt = now;
    const registry = new TerminalSessionRegistry({
      now: () => now,
      tokenFactory: () => TOKEN_A,
    });
    expect(registry.createSession(admittedInput).created).toBe(true);

    for (let elapsed = 4 * 60 * 1000; elapsed < TERMINAL_MAX_LIFETIME_MS; elapsed += 4 * 60 * 1000) {
      now = createdAt + elapsed;
      expect(registry.touch(TOKEN_A)).not.toBeNull();
    }

    now = createdAt + TERMINAL_MAX_LIFETIME_MS;
    expect(registry.touch(TOKEN_A)).toBeNull();
    expect(registry.activeCount()).toBe(0);
  });

  it("supports explicit revoke and keeps old tokens isolated from replacement sessions", () => {
    let now = 50_000;
    const tokens = [TOKEN_A, TOKEN_B];
    const registry = new TerminalSessionRegistry({
      now: () => now,
      tokenFactory: () => tokens.shift() ?? TOKEN_B,
    });

    const first = registry.createSession(admittedInput);
    expect(first.created).toBe(true);
    expect(registry.revoke(TOKEN_A)).toBe(true);
    expect(registry.revoke(TOKEN_A)).toBe(false);

    now += 1;
    const second = registry.createSession(admittedInput);
    expect(second.created).toBe(true);
    if (!second.created) {
      throw new Error("Expected replacement terminal session");
    }
    expect(second.session.token).toBe(TOKEN_B);
    expect(registry.touch(TOKEN_A)).toBeNull();
    expect(registry.touch(TOKEN_B)).not.toBeNull();
  });

  it("rejects malformed token factories instead of weakening token shape", () => {
    const registry = new TerminalSessionRegistry({
      now: () => 60_000,
      tokenFactory: () => "browser-controlled-token",
    });

    expect(() => registry.createSession(admittedInput)).toThrow(
      "Terminal session token factory returned an invalid token",
    );
  });
});
