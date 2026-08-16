# Phase 9D — one-time terminal transport claim foundation

Phase 9D prepares the security boundary between the Phase 9C HTTP session grant and one future terminal WebSocket transport. It adds **no WebSocket route, no socket upgrade, no PTY and no shell execution**.

## Why transport claim is isolated first

The current `@fastify/websocket` documentation states that request hooks such as `onRequest`, `preValidation` and `preHandler` run before the WebSocket connection is established, so authentication and admission can reject the request before upgrade. It also warns that WebSocket message handlers must be attached synchronously once the handler runs or early messages can be lost.

The underlying `ws` server also has a very large default `maxPayload`. The actual Phase 9E transport must therefore be a separate review with deliberately small payload limits, compression disabled unless justified, synchronous handler attachment and fail-closed pre-upgrade authentication.

Phase 9D keeps those transport concerns out of the session-security change and makes the token claim behavior independently testable first.

## One-time transport capability

A session minted by `POST /api/terminal/session` remains an in-memory opaque 256-bit capability with the existing limits:

- one active beta session;
- 5-minute idle timeout;
- 30-minute absolute lifetime;
- no transcript/keystroke/output persistence.

The registry now tracks whether that live session has already been claimed by a transport.

A future upgrade boundary must call the claim operation only after it has independently obtained these facts:

1. terminal runtime is explicitly enabled;
2. owner authentication has been cryptographically verified again;
3. the raw `Origin` is exactly `https://dash.rozkalns.net`;
4. a syntactically valid session token was carried by the reviewed WebSocket protocol header.

Only then can the registry look up the token.

This ordering intentionally avoids using token existence as the first authorization decision.

## Atomic claim semantics

`TerminalSessionRegistry.claimTransport(...)` performs one synchronous in-memory transition.

Possible internal rejection classes are bounded:

- terminal disabled;
- owner auth required;
- Origin required/rejected;
- session token required/invalid;
- session not found (including expired or revoked);
- session already claimed.

The future WebSocket HTTP boundary must collapse these internal details into a small external denial surface rather than exposing a token-validity oracle.

On the first successful claim:

- the session becomes transport-claimed;
- claim time counts as activity;
- the 5-minute idle deadline moves from that activity time;
- the absolute 30-minute deadline remains anchored to original session creation.

A second claim of the same still-live token fails. Reconnect after disconnect therefore requires a fresh session grant.

Existing `revoke(token)` remains the cleanup primitive that the future WebSocket transport must call on disconnect, fatal error or terminal shutdown.

## Future WebSocket protocol carrier

Browser WebSocket APIs cannot attach an arbitrary authorization header. Phase 9D therefore defines a strict source-only parser for a future `Sec-WebSocket-Protocol` carrier instead of placing the bearer token in the URL/query string.

Exact reviewed shape:

```text
Sec-WebSocket-Protocol: dashboard-rpi5-terminal-v1, session.<64-lowercase-hex-token>
```

Rules:

- exactly two comma-separated entries;
- first entry is exactly `dashboard-rpi5-terminal-v1`;
- second entry is exactly `session.` plus 64 lowercase hexadecimal characters;
- only normal HTTP optional whitespace (space/tab) around entries is tolerated;
- arrays, duplicate markers, reordered entries, extra entries, CR/LF, uppercase/short/invalid tokens and oversized headers are rejected;
- the parser returns only the extracted session token or a bounded rejection reason, never the raw header.

The future WebSocket handshake must negotiate/echo only:

```text
dashboard-rpi5-terminal-v1
```

It must never select or echo the `session.<token>` entry as the negotiated protocol.

`selectTerminalWebSocketApplicationProtocol(...)` provides that source-only selection rule for the future plugin integration.

## Intended Phase 9E ordering

The next transport-only phase should be able to remain small:

```text
incoming upgrade request
  -> terminal exact-enable gate
  -> verify Cf-Access-Jwt-Assertion again
  -> exact Origin check
  -> parse strict Sec-WebSocket-Protocol carrier
  -> atomically claim live session token once
  -> upgrade using only fixed application subprotocol
  -> attach close/error/message handlers synchronously
  -> no PTY yet unless a later separately reviewed phase adds it
  -> revoke session on disconnect/fatal error
```

Phase 9D does not register any of those network handlers.

## Tests

Coverage includes:

- exact 256-bit lowercase token shape;
- successful first transport claim;
- duplicate claim rejection;
- activation/auth/Origin checks before token-state lookup;
- missing, malformed and unknown tokens;
- expired and explicitly revoked tokens;
- claim activity without absolute-lifetime extension;
- strict protocol header parsing with normal OWS;
- array/reordered/extra/duplicate/malformed/oversized protocol rejection;
- fixed application-protocol selection;
- bearer token is never selected as the negotiated protocol.

## Explicitly absent

Phase 9D adds no:

- `@fastify/websocket` dependency;
- `ws` dependency change;
- WebSocket route;
- HTTP upgrade handler;
- socket listener;
- WebSocket payload/message processing;
- PTY allocation;
- `node-pty`;
- shell spawn;
- xterm.js runtime;
- resize/input/output terminal protocol;
- production environment values;
- Cloudflare Access, DNS or Tunnel mutation;
- host/systemd/sudo/root mutation;
- production deploy or terminal activation.

## References

- `@fastify/websocket` official repository/documentation — route hooks, synchronous handler attachment, plugin registration and WebSocket options.
- `ws` official API documentation — `maxPayload`, protocol selection and compression behavior.
- Phase 9A terminal session security documentation.
- Phase 9B Cloudflare Access owner-auth verifier documentation.
- Phase 9C terminal session admission documentation.
- Master roadmap issue #1.

**Production deploy: NO.**
