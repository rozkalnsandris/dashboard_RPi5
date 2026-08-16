# Phase 9B — Cloudflare Access owner-auth verifier foundation

Phase 9B adds the cryptographic authentication adapter that a later terminal session boundary can use to produce the trusted `ownerAuthVerified` verdict required by Phase 9A. It remains source-only and deliberately exposes no HTTP terminal endpoint, WebSocket upgrade or PTY process.

## Why this slice exists

Phase 9A intentionally accepts only a pre-verified owner-auth boolean. Origin validation protects browser WebSocket use against cross-site initiation, but an `Origin` value is not identity proof. Before a terminal session can exist, the server therefore needs an independent verifier for the identity assertion issued by Cloudflare Access.

Cloudflare's current Access application-token documentation says the origin receives the application JWT in the `Cf-Access-Jwt-Assertion` header. The token is RS256-signed and carries the Access team issuer, application audience and identity claims. Cloudflare also documents a team-specific `/cdn-cgi/access/certs` endpoint for the rotating public signing keys and recommends validating the JWT signature, issuer and application audience.

This phase implements that verifier as a pure server module. Route wiring remains a later gate.

## Configuration contract

The verifier requires three values supplied by trusted server configuration at construction time:

- Access `teamName`;
- the exact Access application audience tag;
- the exact owner email expected for terminal access.

None of these are accepted from the browser. The repository does not commit the real production values in this phase.

The team name is restricted to one lowercase DNS label. The signing-key endpoint is then derived internally as:

```text
https://<teamName>.cloudflareaccess.com/cdn-cgi/access/certs
```

A caller cannot supply an arbitrary JWK/certificate URL. This prevents a future request path from turning JWT verification into an SSRF primitive.

## Verification order

`CloudflareAccessOwnerAuthVerifier.verifyAssertion()` fails closed and performs the following steps:

1. require a bounded compact JWT with exactly three Base64URL segments;
2. require `alg=RS256`, `typ=JWT` and a bounded `kid`;
3. obtain the matching RSA public key only from the derived Cloudflare Access certs/JWK endpoint;
4. verify the RSA/SHA-256 signature over the original JWT signing input;
5. require the exact configured Access issuer;
6. require the configured application audience in the JWT `aud` array;
7. require an Access application identity assertion with an email and subject;
8. require the email to match the configured owner identity;
9. require bounded numeric `iat`, `nbf` and `exp` claims and enforce activity/expiry with a small bounded clock skew.

Untrusted identity claims are never accepted before signature verification.

## Key rotation

Cloudflare Access signing keys rotate. The verifier therefore does not hard-code a certificate or `kid`.

- parsed signing keys are cached in memory for five minutes;
- a fresh cache hit performs no network request;
- an unknown `kid` against a still-fresh cache triggers one controlled refresh;
- an expired cache is refreshed before key selection;
- malformed/oversized key sets, duplicate `kid` values, non-RSA keys and incompatible `alg`/`use` declarations are ignored or fail closed;
- a fetch failure, timeout or still-missing key yields `KEY_UNAVAILABLE`, never an auth bypass.

The key fetch is bounded by a three-second abort timeout. The endpoint response is size-limited before JWK parsing.

## Identity boundary

The configured owner email is compared only after cryptographic verification. Case differences in a verified email are normalized for comparison; whitespace or malformed email values are rejected.

A Cloudflare service-token-only assertion does not prove the human owner identity required for a browser terminal. A token without the required identity email/subject therefore fails with `IDENTITY_REQUIRED` even if its signature is valid.

A later operational Access policy should independently remain owner-only. The server verifier is defense in depth and must not be treated as a substitute for the Access policy itself.

## Data minimization

The verifier returns only:

- `verified: true` plus the verified owner email and subject; or
- `verified: false` plus a bounded internal rejection reason.

It does not return or persist:

- the bearer JWT;
- JWT signature bytes;
- the full claim set;
- Access cookies;
- terminal commands, keystrokes or output.

No logging is added in this phase. A later route must not reflect detailed verifier failures or token material to the browser.

## Explicitly absent

Phase 9B contains no:

- registration in `apps/server/src/index.ts` or `app.ts`;
- terminal session-creation HTTP route;
- WebSocket route or upgrade handler;
- `node-pty`, shell spawn or xterm.js;
- terminal activation environment wiring;
- Cloudflare DNS, Tunnel or Access policy mutation;
- systemd change;
- sudo/root permission;
- production deploy or host mutation.

The existing Phase 9A terminal security module therefore remains unreachable from the running server after this source slice.

## Validation

Deterministic unit tests generate local RSA key pairs and cover:

- valid owner assertion + signing-key cache;
- wrong signature;
- wrong issuer;
- wrong audience;
- wrong owner identity;
- service-token-only/no-email rejection;
- expiry and not-yet-valid timing;
- malformed/non-RS256 JWT rejection before key fetch;
- Access signing-key rotation through unknown-`kid` refresh;
- unavailable signing keys;
- team-name SSRF/config rejection.

The tests perform no live Cloudflare request and use no production token or secret.

## References

- Cloudflare One / Access: validating Access JWTs at the origin.
- Cloudflare One / Access: application token payload and `Cf-Access-Jwt-Assertion` behavior.
- Node.js 24 crypto documentation: RSA public-key import and signature verification.
- Phase 9A: `docs/PHASE9A_TERMINAL_SESSION_SECURITY.md`.
- Master roadmap issue #1: terminal owner-auth and activation gates.

**Production deploy: NO.**
