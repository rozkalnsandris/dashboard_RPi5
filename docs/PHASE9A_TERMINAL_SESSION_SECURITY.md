# Phase 9A — terminal admission and bounded session security foundation

Phase 9A prepares the security substrate required by the master roadmap's full terminal beta. It deliberately does **not** expose a terminal endpoint, WebSocket upgrade or PTY process.

## Why this slice exists

A browser terminal is the highest-risk dashboard capability. The master contract requires owner-only access, re-authentication at the session/upgrade boundary, exact origin validation, a normal non-root user, idle and absolute time limits, low concurrency, explicit disconnect and no keystroke persistence by default.

Phase 9A encodes the admission and session-lifetime portion of that contract before any shell-capable dependency is introduced.

## Admission policy

The future terminal transport may create a session only when all of these conditions are already proven by trusted server-side code:

1. terminal runtime activation is explicitly enabled;
2. owner authentication has been independently verified;
3. the browser `Origin` is exactly `https://dash.rozkalns.net`;
4. no other beta terminal session is active.

The policy intentionally does not normalize or broaden the accepted Origin. Values such as `http://dash.rozkalns.net`, `https://dash.rozkalns.net/`, case variants, subdomain lookalikes and missing Origin are rejected.

Origin validation is a browser cross-origin defense, **not** owner authentication. RFC 6455 describes the `Origin` header as protection against unauthorized cross-origin WebSocket use, while also warning that non-browser clients can forge it. A later Phase 9 slice must therefore supply a separate verified owner-auth verdict before calling this policy.

Cloudflare Access is the planned production authentication boundary. Its application `CF_Authorization` cookie contains an Access JWT, but Phase 9A does not parse or trust that JWT yet; the future adapter must validate the token according to Cloudflare's current Access documentation before producing `ownerAuthVerified=true`.

## Runtime activation

`isTerminalExplicitlyEnabled()` accepts only the exact string:

```text
enabled
```

Missing, empty, whitespace-padded, differently-cased or alternate truthy values remain disabled. This helper is not wired to server startup in Phase 9A, so there is no production terminal route to activate yet.

## Session limits

Initial beta constants are deliberately conservative:

- maximum active sessions: **1**;
- idle timeout: **5 minutes**;
- absolute maximum lifetime: **30 minutes**;
- session token entropy: **32 random bytes / 256 bits**.

The in-memory registry lazily removes expired sessions on access. Activity may extend the idle deadline but can never extend the absolute maximum lifetime.

Tokens are generated with Node.js `crypto.randomBytes()` and encoded as 64 lowercase hexadecimal characters. Browser input is never used to construct a token. Test-only token factories must preserve the same shape or session creation fails closed.

The registry supports explicit revoke. A revoked or expired token cannot be touched or reused to reach a replacement session.

## Data minimization

Stored session metadata is limited to:

- creation timestamp;
- last-activity timestamp.

Phase 9A stores no:

- shell command;
- keystroke;
- terminal output;
- PTY transcript;
- environment variables;
- credentials;
- filesystem path;
- sudo state.

No persistent database or log is introduced.

## Explicitly absent

This phase contains no:

- HTTP session-creation endpoint;
- WebSocket route or upgrade handler;
- `node-pty` or other PTY dependency;
- shell spawn;
- xterm.js runtime;
- Cloudflare Access JWT verification implementation;
- sudo/root access;
- systemd or host permission change;
- Cloudflare mutation;
- production deploy or activation.

The security module is intentionally unreferenced by `apps/server/src/app.ts` until a later reviewed Phase 9 slice supplies the authentication adapter and transport boundary.

## Validation

Unit tests cover:

- exact activation string only;
- terminal-disabled rejection;
- missing owner-auth rejection;
- missing/wrong/lookalike Origin rejection;
- one-session concurrency cap;
- idle expiry at the exact boundary;
- absolute lifetime expiry despite activity;
- explicit revoke;
- old-token isolation after replacement;
- malformed token-factory rejection.

Repository CI still runs deterministic dependency install, dependency audit, TypeScript typecheck, lint, unit tests, production build and the existing responsive/A55 browser suite.

## References

- RFC 6455 — The WebSocket Protocol, sections 4 and 10: browser Origin semantics and origin-validation security considerations.
- Node.js 24 `crypto.randomBytes()` documentation: cryptographically strong pseudorandom bytes.
- Cloudflare Access authorization-cookie documentation: application `CF_Authorization` JWT behavior.
- Master roadmap issue #1 — terminal security contract and Phase 9 requirements.

**Production deploy: NO.**
