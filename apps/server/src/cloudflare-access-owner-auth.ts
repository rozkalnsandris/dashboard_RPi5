import {
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";

export const ACCESS_JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
export const ACCESS_JWKS_REQUEST_TIMEOUT_MS = 3_000;
export const ACCESS_UNKNOWN_KID_REFRESH_COOLDOWN_MS = 30_000;
export const ACCESS_CLOCK_SKEW_SECONDS = 30;

const MAX_JWT_LENGTH = 16 * 1024;
const MAX_JWT_SEGMENT_LENGTH = 12 * 1024;
const MAX_DECODED_JSON_BYTES = 8 * 1024;
const MAX_SIGNATURE_BYTES = 1024;
const MAX_JWKS_BODY_BYTES = 128 * 1024;
const MAX_JWKS_KEYS = 16;
const MAX_KID_LENGTH = 256;
const MAX_AUDIENCE_LENGTH = 512;
const MAX_EMAIL_LENGTH = 320;
const MAX_SUBJECT_LENGTH = 512;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const TEAM_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type CloudflareAccessOwnerAuthRejection =
  | "TOKEN_MISSING"
  | "TOKEN_MALFORMED"
  | "UNSUPPORTED_ALGORITHM"
  | "KEY_UNAVAILABLE"
  | "SIGNATURE_INVALID"
  | "ISSUER_MISMATCH"
  | "AUDIENCE_MISMATCH"
  | "TOKEN_NOT_ACTIVE"
  | "TOKEN_EXPIRED"
  | "IDENTITY_REQUIRED"
  | "OWNER_MISMATCH";

export type CloudflareAccessOwnerAuthResult =
  | {
      verified: true;
      identity: {
        email: string;
        subject: string;
      };
    }
  | {
      verified: false;
      reason: CloudflareAccessOwnerAuthRejection;
    };

interface AccessFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

interface AccessFetchInit {
  signal: AbortSignal;
}

export type AccessFetch = (
  url: string,
  init: AccessFetchInit,
) => Promise<AccessFetchResponse>;

export interface CloudflareAccessOwnerAuthOptions {
  teamName: string;
  applicationAudience: string;
  ownerEmail: string;
  fetchImpl?: AccessFetch;
  nowMs?: () => number;
  keyCacheTtlMs?: number;
  requestTimeoutMs?: number;
  unknownKidRefreshCooldownMs?: number;
  clockSkewSeconds?: number;
}

interface ParsedJwt {
  signingInput: string;
  signature: Buffer;
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
}

interface RsaSigningJwk {
  kty: "RSA";
  kid: string;
  n: string;
  e: string;
}

const defaultFetch: AccessFetch = async (url, init) => fetch(url, init);

export class CloudflareAccessOwnerAuthVerifier {
  readonly #issuer: string;
  readonly #certsUrl: string;
  readonly #applicationAudience: string;
  readonly #ownerEmail: string;
  readonly #fetchImpl: AccessFetch;
  readonly #nowMs: () => number;
  readonly #keyCacheTtlMs: number;
  readonly #requestTimeoutMs: number;
  readonly #unknownKidRefreshCooldownMs: number;
  readonly #clockSkewSeconds: number;
  #keys = new Map<string, KeyObject>();
  #keysFetchedAtMs = Number.NEGATIVE_INFINITY;
  #lastUnknownKidRefreshAtMs = Number.NEGATIVE_INFINITY;

  constructor(options: CloudflareAccessOwnerAuthOptions) {
    if (!TEAM_NAME_PATTERN.test(options.teamName)) {
      throw new Error("Cloudflare Access team name is invalid");
    }
    if (!isBoundedConfigValue(options.applicationAudience, MAX_AUDIENCE_LENGTH)) {
      throw new Error("Cloudflare Access application audience is invalid");
    }
    if (!isValidEmailValue(options.ownerEmail)) {
      throw new Error("Cloudflare Access owner email is invalid");
    }

    this.#issuer = `https://${options.teamName}.cloudflareaccess.com`;
    this.#certsUrl = `${this.#issuer}/cdn-cgi/access/certs`;
    this.#applicationAudience = options.applicationAudience;
    this.#ownerEmail = options.ownerEmail.toLowerCase();
    this.#fetchImpl = options.fetchImpl ?? defaultFetch;
    this.#nowMs = options.nowMs ?? Date.now;
    this.#keyCacheTtlMs = readBoundedPositiveOption(
      options.keyCacheTtlMs,
      ACCESS_JWKS_CACHE_TTL_MS,
      1_000,
      60 * 60 * 1000,
      "key cache TTL",
    );
    this.#requestTimeoutMs = readBoundedPositiveOption(
      options.requestTimeoutMs,
      ACCESS_JWKS_REQUEST_TIMEOUT_MS,
      250,
      10_000,
      "request timeout",
    );
    this.#unknownKidRefreshCooldownMs = readBoundedPositiveOption(
      options.unknownKidRefreshCooldownMs,
      ACCESS_UNKNOWN_KID_REFRESH_COOLDOWN_MS,
      1_000,
      5 * 60 * 1000,
      "unknown kid refresh cooldown",
    );
    this.#clockSkewSeconds = readBoundedPositiveOption(
      options.clockSkewSeconds,
      ACCESS_CLOCK_SKEW_SECONDS,
      1,
      300,
      "clock skew",
    );
  }

  async verifyAssertion(
    assertion: string | undefined,
  ): Promise<CloudflareAccessOwnerAuthResult> {
    if (assertion === undefined || assertion.length === 0) {
      return { verified: false, reason: "TOKEN_MISSING" };
    }

    const parsed = parseJwt(assertion);
    if (parsed === null) {
      return { verified: false, reason: "TOKEN_MALFORMED" };
    }

    if (parsed.header.alg !== "RS256" || parsed.header.typ !== "JWT") {
      return { verified: false, reason: "UNSUPPORTED_ALGORITHM" };
    }

    const kid = readBoundedString(parsed.header.kid, MAX_KID_LENGTH);
    if (kid === null) {
      return { verified: false, reason: "TOKEN_MALFORMED" };
    }

    const key = await this.#getSigningKey(kid);
    if (key === null) {
      return { verified: false, reason: "KEY_UNAVAILABLE" };
    }

    try {
      if (
        !verifySignature(
          "RSA-SHA256",
          Buffer.from(parsed.signingInput, "ascii"),
          key,
          parsed.signature,
        )
      ) {
        return { verified: false, reason: "SIGNATURE_INVALID" };
      }
    } catch {
      return { verified: false, reason: "SIGNATURE_INVALID" };
    }

    return this.#validateVerifiedClaims(parsed.claims);
  }

  #validateVerifiedClaims(
    claims: Record<string, unknown>,
  ): CloudflareAccessOwnerAuthResult {
    if (claims.iss !== this.#issuer) {
      return { verified: false, reason: "ISSUER_MISMATCH" };
    }

    if (!hasExpectedAudience(claims.aud, this.#applicationAudience)) {
      return { verified: false, reason: "AUDIENCE_MISMATCH" };
    }

    if (claims.type !== "app") {
      return { verified: false, reason: "IDENTITY_REQUIRED" };
    }

    const email = readBoundedString(claims.email, MAX_EMAIL_LENGTH);
    const subject = readBoundedString(claims.sub, MAX_SUBJECT_LENGTH);
    if (email === null || subject === null || !isValidEmailValue(email)) {
      return { verified: false, reason: "IDENTITY_REQUIRED" };
    }
    if (email.toLowerCase() !== this.#ownerEmail) {
      return { verified: false, reason: "OWNER_MISMATCH" };
    }

    const exp = readNumericDate(claims.exp);
    const iat = readNumericDate(claims.iat);
    const nbf = readNumericDate(claims.nbf);
    if (exp === null || iat === null || nbf === null || exp <= iat || exp <= nbf) {
      return { verified: false, reason: "TOKEN_MALFORMED" };
    }

    const nowSeconds = Math.floor(this.#readNowMs() / 1000);
    if (iat > nowSeconds + this.#clockSkewSeconds || nbf > nowSeconds + this.#clockSkewSeconds) {
      return { verified: false, reason: "TOKEN_NOT_ACTIVE" };
    }
    if (nowSeconds >= exp + this.#clockSkewSeconds) {
      return { verified: false, reason: "TOKEN_EXPIRED" };
    }

    return {
      verified: true,
      identity: {
        email,
        subject,
      },
    };
  }

  async #getSigningKey(kid: string): Promise<KeyObject | null> {
    const now = this.#readNowMs();
    let refreshedForStaleness = false;
    if (this.#keys.size === 0 || now - this.#keysFetchedAtMs >= this.#keyCacheTtlMs) {
      if (!(await this.#refreshSigningKeys())) {
        return null;
      }
      refreshedForStaleness = true;
    }

    const cached = this.#keys.get(kid);
    if (cached !== undefined) {
      return cached;
    }

    if (refreshedForStaleness) {
      return null;
    }

    if (now - this.#lastUnknownKidRefreshAtMs < this.#unknownKidRefreshCooldownMs) {
      return null;
    }

    this.#lastUnknownKidRefreshAtMs = now;
    if (!(await this.#refreshSigningKeys())) {
      return null;
    }
    return this.#keys.get(kid) ?? null;
  }

  async #refreshSigningKeys(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#requestTimeoutMs);
    try {
      const response = await this.#fetchImpl(this.#certsUrl, {
        signal: controller.signal,
      });
      if (!response.ok) {
        return false;
      }

      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > MAX_JWKS_BODY_BYTES) {
        return false;
      }

      const keys = parseSigningKeys(body);
      if (keys === null || keys.size === 0) {
        return false;
      }

      this.#keys = keys;
      this.#keysFetchedAtMs = this.#readNowMs();
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  #readNowMs(): number {
    const value = this.#nowMs();
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("Cloudflare Access verifier clock returned an invalid timestamp");
    }
    return value;
  }
}

function parseJwt(token: string): ParsedJwt | null {
  if (token.length > MAX_JWT_LENGTH) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [headerSegment, claimsSegment, signatureSegment] = parts;
  if (
    headerSegment === undefined ||
    claimsSegment === undefined ||
    signatureSegment === undefined ||
    !isValidBase64urlSegment(headerSegment) ||
    !isValidBase64urlSegment(claimsSegment) ||
    !isValidBase64urlSegment(signatureSegment)
  ) {
    return null;
  }

  const header = parseJsonSegment(headerSegment);
  const claims = parseJsonSegment(claimsSegment);
  if (header === null || claims === null) {
    return null;
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(signatureSegment, "base64url");
  } catch {
    return null;
  }
  if (signature.length === 0 || signature.length > MAX_SIGNATURE_BYTES) {
    return null;
  }

  return {
    signingInput: `${headerSegment}.${claimsSegment}`,
    signature,
    header,
    claims,
  };
}

function parseJsonSegment(segment: string): Record<string, unknown> | null {
  let decoded: Buffer;
  try {
    decoded = Buffer.from(segment, "base64url");
  } catch {
    return null;
  }
  if (decoded.length === 0 || decoded.length > MAX_DECODED_JSON_BYTES) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(decoded.toString("utf8"));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function parseSigningKeys(body: string): Map<string, KeyObject> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.keys) || parsed.keys.length > MAX_JWKS_KEYS) {
    return null;
  }

  const keys = new Map<string, KeyObject>();
  for (const candidate of parsed.keys) {
    const jwk = readRsaSigningJwk(candidate);
    if (jwk === null) {
      continue;
    }
    if (keys.has(jwk.kid)) {
      return null;
    }
    try {
      const key = createPublicKey({
        key: {
          kty: jwk.kty,
          n: jwk.n,
          e: jwk.e,
        },
        format: "jwk",
      });
      keys.set(jwk.kid, key);
    } catch {
      continue;
    }
  }
  return keys;
}

function readRsaSigningJwk(value: unknown): RsaSigningJwk | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kty !== "RSA") {
    return null;
  }
  if (value.alg !== undefined && value.alg !== "RS256") {
    return null;
  }
  if (value.use !== undefined && value.use !== "sig") {
    return null;
  }

  const kid = readBoundedString(value.kid, MAX_KID_LENGTH);
  const n = readBoundedString(value.n, 2048);
  const e = readBoundedString(value.e, 32);
  if (
    kid === null ||
    n === null ||
    e === null ||
    !BASE64URL_PATTERN.test(n) ||
    !BASE64URL_PATTERN.test(e)
  ) {
    return null;
  }
  return { kty: "RSA", kid, n, e };
}

function hasExpectedAudience(value: unknown, expected: string): boolean {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    return false;
  }
  return value.every((entry) => typeof entry === "string") && value.includes(expected);
}

function readNumericDate(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    return null;
  }
  if (value !== value.trim() || /\s/.test(value)) {
    return null;
  }
  return value;
}

function isBoundedConfigValue(value: string, maxLength: number): boolean {
  return readBoundedString(value, maxLength) !== null;
}

function isValidEmailValue(value: string): boolean {
  if (readBoundedString(value, MAX_EMAIL_LENGTH) === null) {
    return false;
  }
  const at = value.indexOf("@");
  return at > 0 && at === value.lastIndexOf("@") && at < value.length - 1;
}

function isValidBase64urlSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_JWT_SEGMENT_LENGTH &&
    value.length % 4 !== 1 &&
    BASE64URL_PATTERN.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoundedPositiveOption(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`Cloudflare Access ${label} is invalid`);
  }
  return resolved;
}
