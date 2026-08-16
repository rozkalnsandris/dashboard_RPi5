# Phase 9C — terminal session admission API

Phase 9C joins the Phase 9A terminal session policy and Phase 9B Cloudflare Access owner-auth verifier at one bounded HTTP boundary. It still does **not** provide a WebSocket, PTY, shell or terminal UI runtime.

## Endpoint

The server registers:

```text
POST /api/terminal/session
```

The request body must be an empty JSON object. Unexpected body fields fail validation before admission code runs. The route has a small body limit and returns `Cache-Control: no-store` on every handled response.

Security-sensitive request headers are read from the raw incoming request headers rather than from a header schema:

- `Origin`
- `Cf-Access-Jwt-Assertion`

Fastify documents that route header schemas may mutate request headers during validation. Avoiding a header schema for these values keeps the security decision tied to the raw incoming values.

## Cloudflare Access assertion

Cloudflare Access documents that requests sent to an origin include the application token in the `Cf-Access-Jwt-Assertion` header and recommends validating that header instead of relying on the `CF_Authorization` cookie.

Phase 9C passes only that assertion into the Phase 9B verifier. The route does not accept browser-supplied email, subject, audience, issuer or signing-key location fields.

The Access JWT, signature and claims are never returned by the endpoint and are not stored in the terminal session registry.

## Activation gate

The default server is disabled unless the exact value is present:

```text
DASHBOARD_TERMINAL_ENABLED=enabled
```

Any missing, empty, differently-cased or alternate truthy value remains disabled. In disabled mode the default admission factory does not construct the Cloudflare Access verifier and therefore cannot fetch Access signing keys.

Only after exact activation does the server require:

```text
DASHBOARD_TERMINAL_ACCESS_TEAM
DASHBOARD_TERMINAL_ACCESS_AUD
DASHBOARD_TERMINAL_OWNER_EMAIL
```

Explicit activation with missing or whitespace-padded configuration fails closed during server construction. These values are configuration, not terminal credentials; no production values are committed by this phase.

## Admission sequence

For an enabled server:

1. verify the Access assertion cryptographically through the Phase 9B verifier;
2. require the configured owner identity;
3. pass the verified owner verdict and raw `Origin` into the Phase 9A session registry;
4. require the exact production origin `https://dash.rozkalns.net`;
5. enforce the one-session beta concurrency limit;
6. create one opaque 256-bit session token.

The successful response contains only:

- the opaque session token;
- the 5-minute idle timeout;
- the 30-minute absolute maximum lifetime.

It does not expose process-relative timestamps, Access claims or host state.

## Bounded error surface

The API maps internal outcomes to a small response set:

- `400 INVALID_REQUEST` — malformed/non-empty request body;
- `404 TERMINAL_UNAVAILABLE` — terminal runtime gate is not enabled;
- `403 ADMISSION_DENIED` — owner authentication or Origin admission failed;
- `409 SESSION_LIMIT` — a verified owner already has the single beta session occupied;
- `503 AUTH_UNAVAILABLE` — Access signing-key verification could not be completed.

Authentication rejection details such as wrong issuer, wrong audience, wrong owner, malformed JWT or invalid signature are deliberately collapsed into `ADMISSION_DENIED` at the HTTP boundary.

## Session state

Phase 9C reuses the Phase 9A in-memory registry:

- maximum active sessions: 1;
- idle timeout: 5 minutes;
- absolute lifetime: 30 minutes;
- token entropy: 32 random bytes / 256 bits;
- no shell command, keystroke or PTY output persistence.

A future WebSocket/PTY phase must authenticate the session again at the upgrade boundary, bind the session token to exactly one live terminal transport, revoke it on disconnect/expiry and kill the PTY on termination.

## Explicitly absent

Phase 9C adds no:

- WebSocket or upgrade handler;
- PTY allocation;
- `node-pty` dependency;
- shell spawn;
- xterm.js runtime;
- terminal frontend session wiring;
- sudo/root behavior;
- production environment values;
- Cloudflare Access, DNS or Tunnel mutation;
- systemd or host permission mutation;
- production deploy or terminal activation.

## Validation

Tests cover:

- non-exact activation stays disabled and never constructs Access auth;
- explicit enable with incomplete configuration fails closed;
- valid owner + exact Origin creates one opaque bounded session;
- missing/invalid owner auth allocates no session;
- Access key availability failure is bounded;
- wrong/lookalike Origin allocates no session;
- one-session concurrency limit;
- verifier exceptions fail closed;
- raw security headers are passed to admission without identity synthesis;
- every API result uses `no-store`;
- unexpected body fields are rejected before admission;
- Access assertions are not reflected in error responses;
- `buildApp` registers the route while an injected disabled admission remains unavailable.

## References

- Cloudflare One documentation — Validate JWTs / `Cf-Access-Jwt-Assertion` origin header and Access signing keys.
- Fastify documentation — request headers and TypeScript/type-provider route schemas.
- Phase 9A terminal session security documentation.
- Phase 9B Cloudflare Access owner-auth verifier documentation.
- Master roadmap issue #1.

**Production deploy: NO.**
