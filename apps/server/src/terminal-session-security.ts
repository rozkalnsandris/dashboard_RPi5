import { randomBytes } from "node:crypto";

export const TERMINAL_EXPECTED_ORIGIN = "https://dash.rozkalns.net";
export const TERMINAL_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
export const TERMINAL_MAX_LIFETIME_MS = 30 * 60 * 1000;
export const TERMINAL_MAX_CONCURRENT_SESSIONS = 1;
export const TERMINAL_SESSION_TOKEN_BYTES = 32;

export type TerminalAdmissionRejection =
  | "TERMINAL_DISABLED"
  | "OWNER_AUTH_REQUIRED"
  | "ORIGIN_REQUIRED"
  | "ORIGIN_REJECTED"
  | "CONCURRENCY_LIMIT";

export type TerminalAdmissionDecision =
  | { allowed: true }
  | { allowed: false; reason: TerminalAdmissionRejection };

export interface TerminalAdmissionInput {
  terminalEnabled: boolean;
  ownerAuthVerified: boolean;
  origin: string | undefined;
  activeSessions: number;
}

export interface TerminalSessionMetadata {
  createdAtMs: number;
  lastActivityAtMs: number;
  idleExpiresAtMs: number;
  maxExpiresAtMs: number;
}

export interface TerminalSessionGrant extends TerminalSessionMetadata {
  token: string;
}

export type TerminalSessionCreateResult =
  | { created: true; session: TerminalSessionGrant }
  | { created: false; reason: TerminalAdmissionRejection };

interface StoredTerminalSession {
  createdAtMs: number;
  lastActivityAtMs: number;
}

interface TerminalSessionRegistryOptions {
  now?: () => number;
  tokenFactory?: () => string;
}

const MAX_TOKEN_GENERATION_ATTEMPTS = 8;
const HEX_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function isTerminalExplicitlyEnabled(value: string | undefined): boolean {
  return value === "enabled";
}

export function evaluateTerminalAdmission(
  input: TerminalAdmissionInput,
): TerminalAdmissionDecision {
  if (!input.terminalEnabled) {
    return { allowed: false, reason: "TERMINAL_DISABLED" };
  }

  if (!input.ownerAuthVerified) {
    return { allowed: false, reason: "OWNER_AUTH_REQUIRED" };
  }

  if (input.origin === undefined || input.origin.length === 0) {
    return { allowed: false, reason: "ORIGIN_REQUIRED" };
  }

  if (input.origin !== TERMINAL_EXPECTED_ORIGIN) {
    return { allowed: false, reason: "ORIGIN_REJECTED" };
  }

  if (
    !Number.isInteger(input.activeSessions) ||
    input.activeSessions < 0 ||
    input.activeSessions >= TERMINAL_MAX_CONCURRENT_SESSIONS
  ) {
    return { allowed: false, reason: "CONCURRENCY_LIMIT" };
  }

  return { allowed: true };
}

export class TerminalSessionRegistry {
  readonly #sessions = new Map<string, StoredTerminalSession>();
  readonly #now: () => number;
  readonly #tokenFactory: () => string;

  constructor(options: TerminalSessionRegistryOptions = {}) {
    this.#now = options.now ?? (() => Date.now());
    this.#tokenFactory =
      options.tokenFactory ??
      (() => randomBytes(TERMINAL_SESSION_TOKEN_BYTES).toString("hex"));
  }

  createSession(input: Omit<TerminalAdmissionInput, "activeSessions">): TerminalSessionCreateResult {
    const now = this.#readNow();
    this.#pruneExpired(now);

    const decision = evaluateTerminalAdmission({
      ...input,
      activeSessions: this.#sessions.size,
    });
    if (!decision.allowed) {
      return { created: false, reason: decision.reason };
    }

    const token = this.#createUniqueToken();
    const stored: StoredTerminalSession = {
      createdAtMs: now,
      lastActivityAtMs: now,
    };
    this.#sessions.set(token, stored);

    return {
      created: true,
      session: {
        token,
        ...this.#toMetadata(stored),
      },
    };
  }

  touch(token: string): TerminalSessionMetadata | null {
    const now = this.#readNow();
    this.#pruneExpired(now);
    const session = this.#sessions.get(token);
    if (session === undefined) {
      return null;
    }

    session.lastActivityAtMs = now;
    return this.#toMetadata(session);
  }

  revoke(token: string): boolean {
    return this.#sessions.delete(token);
  }

  activeCount(): number {
    const now = this.#readNow();
    this.#pruneExpired(now);
    return this.#sessions.size;
  }

  #createUniqueToken(): string {
    for (let attempt = 0; attempt < MAX_TOKEN_GENERATION_ATTEMPTS; attempt += 1) {
      const token = this.#tokenFactory();
      if (!HEX_TOKEN_PATTERN.test(token)) {
        throw new Error("Terminal session token factory returned an invalid token");
      }
      if (!this.#sessions.has(token)) {
        return token;
      }
    }

    throw new Error("Unable to allocate a unique terminal session token");
  }

  #pruneExpired(now: number): void {
    for (const [token, session] of this.#sessions) {
      if (this.#isExpired(session, now)) {
        this.#sessions.delete(token);
      }
    }
  }

  #isExpired(session: StoredTerminalSession, now: number): boolean {
    return (
      now - session.lastActivityAtMs >= TERMINAL_IDLE_TIMEOUT_MS ||
      now - session.createdAtMs >= TERMINAL_MAX_LIFETIME_MS
    );
  }

  #toMetadata(session: StoredTerminalSession): TerminalSessionMetadata {
    return {
      createdAtMs: session.createdAtMs,
      lastActivityAtMs: session.lastActivityAtMs,
      idleExpiresAtMs: session.lastActivityAtMs + TERMINAL_IDLE_TIMEOUT_MS,
      maxExpiresAtMs: session.createdAtMs + TERMINAL_MAX_LIFETIME_MS,
    };
  }

  #readNow(): number {
    const now = this.#now();
    if (!Number.isFinite(now) || now < 0) {
      throw new Error("Terminal session clock returned an invalid timestamp");
    }
    return now;
  }
}
