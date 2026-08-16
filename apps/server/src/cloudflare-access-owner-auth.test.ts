import {
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  CloudflareAccessOwnerAuthVerifier,
  type AccessFetch,
} from "./cloudflare-access-owner-auth.js";

const NOW_MS = 1_800_000_000_000;
const NOW_SECONDS = Math.floor(NOW_MS / 1000);
const TEAM_NAME = "dashboard-owner";
const AUDIENCE = "0123456789abcdef0123456789abcdef";
const OWNER_EMAIL = "owner@example.com";

const keyPairA = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyPairB = generateKeyPairSync("rsa", { modulusLength: 2048 });

const jwkA = makeSigningJwk(keyPairA.publicKey, "key-a");
const jwkB = makeSigningJwk(keyPairB.publicKey, "key-b");

const validClaims = {
  iss: `https://${TEAM_NAME}.cloudflareaccess.com`,
  aud: [AUDIENCE],
  type: "app",
  email: OWNER_EMAIL,
  sub: "owner-subject",
  iat: NOW_SECONDS - 60,
  nbf: NOW_SECONDS - 60,
  exp: NOW_SECONDS + 600,
} as const;

describe("CloudflareAccessOwnerAuthVerifier", () => {
  it("verifies a correctly signed owner identity assertion and caches signing keys", async () => {
    const fetchImpl = vi.fn<AccessFetch>(async () => responseWithKeys([jwkA]));
    const verifier = createVerifier(fetchImpl);
    const token = signJwt(validClaims, keyPairA.privateKey, "key-a");

    await expect(verifier.verifyAssertion(token)).resolves.toEqual({
      verified: true,
      identity: {
        email: OWNER_EMAIL,
        subject: "owner-subject",
      },
    });
    await expect(verifier.verifyAssertion(token)).resolves.toMatchObject({ verified: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `https://${TEAM_NAME}.cloudflareaccess.com/cdn-cgi/access/certs`,
    );
  });

  it("rejects a token whose signature does not match the advertised kid", async () => {
    const verifier = createVerifier(async () => responseWithKeys([jwkA]));
    const token = signJwt(validClaims, keyPairB.privateKey, "key-a");

    await expect(verifier.verifyAssertion(token)).resolves.toEqual({
      verified: false,
      reason: "SIGNATURE_INVALID",
    });
  });

  it.each([
    ["wrong issuer", { ...validClaims, iss: "https://evil.example" }, "ISSUER_MISMATCH"],
    ["wrong audience", { ...validClaims, aud: ["other-app"] }, "AUDIENCE_MISMATCH"],
    ["wrong owner", { ...validClaims, email: "other@example.com" }, "OWNER_MISMATCH"],
  ] as const)("rejects %s after signature verification", async (_name, claims, reason) => {
    const verifier = createVerifier(async () => responseWithKeys([jwkA]));
    const token = signJwt(claims, keyPairA.privateKey, "key-a");

    await expect(verifier.verifyAssertion(token)).resolves.toEqual({
      verified: false,
      reason,
    });
  });

  it("rejects a service-token-only assertion without an owner identity", async () => {
    const verifier = createVerifier(async () => responseWithKeys([jwkA]));
    const { email: _email, ...serviceClaims } = validClaims;
    const token = signJwt(
      {
        ...serviceClaims,
        common_name: "service-token-client-id.access",
      },
      keyPairA.privateKey,
      "key-a",
    );

    await expect(verifier.verifyAssertion(token)).resolves.toEqual({
      verified: false,
      reason: "IDENTITY_REQUIRED",
    });
  });

  it("rejects expired and not-yet-active assertions", async () => {
    const verifier = createVerifier(async () => responseWithKeys([jwkA]));
    const expired = signJwt(
      {
        ...validClaims,
        iat: NOW_SECONDS - 600,
        nbf: NOW_SECONDS - 600,
        exp: NOW_SECONDS - 31,
      },
      keyPairA.privateKey,
      "key-a",
    );
    const future = signJwt(
      {
        ...validClaims,
        iat: NOW_SECONDS + 31,
        nbf: NOW_SECONDS + 31,
        exp: NOW_SECONDS + 900,
      },
      keyPairA.privateKey,
      "key-a",
    );

    await expect(verifier.verifyAssertion(expired)).resolves.toEqual({
      verified: false,
      reason: "TOKEN_EXPIRED",
    });
    await expect(verifier.verifyAssertion(future)).resolves.toEqual({
      verified: false,
      reason: "TOKEN_NOT_ACTIVE",
    });
  });

  it("rejects malformed and non-RS256 tokens before trusting claims", async () => {
    const fetchImpl = vi.fn<AccessFetch>(async () => responseWithKeys([jwkA]));
    const verifier = createVerifier(fetchImpl);
    const hsHeader = encodeJson({ alg: "HS256", typ: "JWT", kid: "key-a" });
    const claims = encodeJson(validClaims);
    const unsupported = `${hsHeader}.${claims}.${Buffer.from("signature").toString("base64url")}`;

    await expect(verifier.verifyAssertion("not-a-jwt")).resolves.toEqual({
      verified: false,
      reason: "TOKEN_MALFORMED",
    });
    await expect(verifier.verifyAssertion(unsupported)).resolves.toEqual({
      verified: false,
      reason: "UNSUPPORTED_ALGORITHM",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes a fresh key cache once when Access rotates to an unknown kid", async () => {
    let activeKeys = [jwkA];
    const fetchImpl = vi.fn<AccessFetch>(async () => responseWithKeys(activeKeys));
    const verifier = createVerifier(fetchImpl);

    const tokenA = signJwt(validClaims, keyPairA.privateKey, "key-a");
    await expect(verifier.verifyAssertion(tokenA)).resolves.toMatchObject({ verified: true });

    activeKeys = [jwkB];
    const tokenB = signJwt(validClaims, keyPairB.privateKey, "key-b");
    await expect(verifier.verifyAssertion(tokenB)).resolves.toMatchObject({ verified: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails closed when signing keys cannot be obtained", async () => {
    const verifier = createVerifier(async () => ({
      ok: false,
      status: 503,
      text: async () => "unavailable",
    }));
    const token = signJwt(validClaims, keyPairA.privateKey, "key-a");

    await expect(verifier.verifyAssertion(token)).resolves.toEqual({
      verified: false,
      reason: "KEY_UNAVAILABLE",
    });
  });

  it("rejects configuration that could redirect the signing-key fetch", () => {
    expect(
      () =>
        new CloudflareAccessOwnerAuthVerifier({
          teamName: "example.com/evil",
          applicationAudience: AUDIENCE,
          ownerEmail: OWNER_EMAIL,
        }),
    ).toThrow("team name is invalid");
  });
});

function createVerifier(fetchImpl: AccessFetch): CloudflareAccessOwnerAuthVerifier {
  return new CloudflareAccessOwnerAuthVerifier({
    teamName: TEAM_NAME,
    applicationAudience: AUDIENCE,
    ownerEmail: OWNER_EMAIL,
    fetchImpl,
    nowMs: () => NOW_MS,
  });
}

function responseWithKeys(keys: unknown[]): {
  ok: true;
  status: 200;
  text(): Promise<string>;
} {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ keys }),
  };
}

function makeSigningJwk(publicKey: KeyObject, kid: string): Record<string, unknown> {
  return {
    ...publicKey.export({ format: "jwk" }),
    kid,
    alg: "RS256",
    use: "sig",
  };
}

function signJwt(
  claims: Record<string, unknown>,
  privateKey: KeyObject,
  kid: string,
): string {
  const header = encodeJson({ alg: "RS256", typ: "JWT", kid });
  const payload = encodeJson(claims);
  const signingInput = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput, "ascii"), privateKey).toString(
    "base64url",
  );
  return `${signingInput}.${signature}`;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
