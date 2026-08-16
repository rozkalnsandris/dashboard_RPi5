# Phase 9E — authenticated bounded terminal WebSocket transport

Status: source-only implementation for issue #57. Production activation is explicitly out of scope.

## Purpose

Phase 9E is the first phase that adds a real WebSocket upgrade path for the future owner-only terminal. It does **not** add a terminal yet.

The transport is intentionally inert:

- no PTY allocation;
- no `node-pty`;
- no child process or shell spawn;
- no command execution;
- no xterm.js;
- no terminal resize/input/output application protocol;
- no production environment values;
- no Cloudflare, Tunnel, DNS, host, systemd, sudo or root mutation.

Any data frame received after a successful Phase 9E upgrade closes the socket with a fixed policy close. Nothing from the frame is echoed or executed.

## Documentation basis reviewed 2026-08-16

### `@fastify/websocket` 11.3.0

The official Fastify WebSocket repository documents these properties used by Phase 9E:

- the plugin must be registered before routes that need WebSocket interception;
- request hooks before upgrade, including `onRequest`, `preValidation` and `preHandler`, can perform authentication;
- after a connection is established, event handlers must be attached synchronously so early messages are not silently dropped;
- the plugin exposes the underlying `ws` server options including `maxPayload`, `handleProtocols` and `perMessageDeflate`;
- `request.ws` is set by the plugin before later request hooks, allowing the route to distinguish an actual upgrade dispatch from an ordinary HTTP GET;
- `injectWS` is the supported test helper for WebSocket routes.

Phase 9E pins `@fastify/websocket` to `11.3.0` and `@types/ws` to `8.18.1`.

### Cloudflare WebSockets and Access

Cloudflare Network documentation states that proxied WebSocket connections are supported.

Cloudflare Access documentation states that authenticated requests forwarded to an origin include the application JWT in `Cf-Access-Jwt-Assertion` and that the origin must validate the signed token, issuer, audience and identity. Phase 9E reuses the Phase 9B verifier rather than trusting a cookie or an unverified header.

## Runtime composition

`createDefaultTerminalRuntime()` owns the security state required by both sides of the handoff:

1. one `TerminalSessionRegistry`;
2. one `OwnerAuthVerifier` instance when the terminal is exactly enabled;
3. the Phase 9C HTTP `sessionAdmission` function;
4. the Phase 9E `websocketAdmission` function.

The runtime creates the HTTP admission through the existing Phase 9C factory while capturing the exact verifier instance built by that factory. The same verifier and the same registry are then passed to WebSocket admission.

This avoids two dangerous split-brain states:

- an HTTP session minted into registry A while the WebSocket checks registry B;
- HTTP and WebSocket boundaries silently using different owner-auth verifier configuration.

When `DASHBOARD_TERMINAL_ENABLED` is not exactly `enabled`, no Access verifier is constructed and both admissions fail closed as unavailable.

## Upgrade admission order

The WebSocket admission service uses this order:

1. terminal must be exactly enabled;
2. `Cf-Access-Jwt-Assertion` is independently verified as the configured owner;
3. `Origin` must exactly equal `https://dash.rozkalns.net`;
4. `Sec-WebSocket-Protocol` must match the bounded Phase 9D carrier;
5. the extracted 256-bit lowercase-hex capability must atomically claim a live session in the shared registry;
6. replay, unknown, expired or revoked capabilities are denied.

Externally, malformed, unknown, expired and replayed capabilities all collapse to `ADMISSION_DENIED`. The route does not expose a capability-state oracle.

Signing-key/JWKS unavailability and verifier exceptions map to `AUTH_UNAVAILABLE`, never to an authorization success.

## Capability carrier and protocol negotiation

The browser-compatible carrier remains:

```text
Sec-WebSocket-Protocol: dashboard-rpi5-terminal-v1, session.<64-lowercase-hex-token>
```

The bearer capability is **not** placed in the URL or query string.

`handleProtocols` delegates to the Phase 9D selector. A valid handshake negotiates only:

```text
dashboard-rpi5-terminal-v1
```

The `session.<token>` entry is never selected or intentionally echoed as the negotiated subprotocol.

## WebSocket server limits

Phase 9E configures the WebSocket server with:

- `maxPayload = 4096` bytes;
- `perMessageDeflate = false`;
- strict protocol selection;
- one explicit route: `GET /api/terminal/ws`.

There is no wildcard WebSocket route.

The 4 KiB limit is deliberately conservative because Phase 9E has no accepted application messages at all. A later terminal-I/O phase must review its own input/paste framing and may change the bound only with tests and explicit security review.

Disabling per-message compression removes unnecessary compression state and decompression work from this pre-terminal transport boundary.

## HTTP versus WebSocket dispatch

The route uses `request.ws`, which `@fastify/websocket` sets in its `onRequest` hook.

- ordinary HTTP `GET /api/terminal/ws` does **not** run capability admission and returns fixed `426 UPGRADE_REQUIRED`;
- a real WebSocket upgrade runs the owner/origin/protocol/session claim boundary before the socket is established;
- denied upgrades return only fixed 403/404/503 error classes with `Cache-Control: no-store`.

This prevents an ordinary HTTP request from consuming a session capability merely by reaching the route handler.

## Established connection lifecycle

The `wsHandler` performs no asynchronous work before installing socket handlers.

It synchronously installs:

- `close` -> revoke the claimed registry session;
- `error` -> revoke the claimed registry session;
- first `message` -> revoke the session and close with code 1008 and fixed reason `TERMINAL_PROTOCOL_NOT_AVAILABLE`.

The revoke path is idempotent.

An oversized message is rejected by the underlying `ws` `maxPayload` boundary before application handling; disconnect/error cleanup removes the claimed session.

## Logging and reflection policy

Phase 9E does not persist or intentionally log:

- the Access JWT;
- decoded Access claims;
- the terminal session token;
- the raw `Sec-WebSocket-Protocol` header;
- inbound WebSocket data.

Responses and close reasons are fixed strings that do not include bearer data.

The server remains configured with `logger: false` as before this phase.

## Test expectations

Phase 9E tests cover:

- exact-disabled runtime remains unavailable and does not construct an Access verifier;
- one verifier and one registry are shared by HTTP mint and WebSocket claim;
- ordinary HTTP GET returns 426 without capability consumption;
- disabled upgrade returns 404;
- missing owner auth returns 403;
- lookalike/wrong Origin returns 403 without consuming the valid capability;
- a valid owner/exact-Origin/live capability upgrades successfully;
- the same capability cannot open a second connection;
- a client data frame closes with fixed code 1008 and no execution path;
- payload larger than 4096 bytes is rejected by the WebSocket payload bound;
- disconnect cleanup revokes the session;
- auth backend unavailability returns fixed 503;
- Phase 9D protocol tests continue to prove strict parsing and token-free protocol selection.

## Production state

Phase 9E changes source code and dependencies only.

It does not set:

- `DASHBOARD_TERMINAL_ENABLED=enabled`;
- Access team/audience/owner production values;
- Cloudflare WebSocket/network settings;
- Cloudflare Access/Tunnel/DNS configuration;
- host service configuration;
- PTY/shell privileges.

Therefore merging Phase 9E alone does not make a production terminal usable.

**Production deploy: NO.**
