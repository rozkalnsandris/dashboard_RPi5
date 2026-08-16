# Phase 9I — authenticated terminal Unix bridge

## Status

Source-only implementation. **Production deploy: NO.**

This phase joins the already-authenticated/claimed browser WebSocket transport to the Phase 9H local terminal-agent protocol while deliberately leaving the production Unix socket, users/groups and systemd units inactive.

## Current evidence baseline

- base `main`: `335c6e54b7313e137ef646c74bbba1919fb0e6b7`;
- predecessor Phase 9H exact-main CI #216 / run `31942584812` = SUCCESS;
- issue: #65.

## External API gate remains unchanged

Before `apps/server` attempts local IPC, the existing terminal path still requires:

1. exact `DASHBOARD_TERMINAL_ENABLED=enabled`;
2. Cloudflare Access owner assertion verification;
3. exact Origin `https://dash.rozkalns.net`;
4. a live 64-hex session capability minted by `POST /api/terminal/session`;
5. the strict WebSocket subprotocol pair;
6. atomic one-time transport claim.

## Local connection

The only production connector target represented in source is:

```text
/run/dashboard-rpi5-terminal.sock
```

Node `net.createConnection({ path })` is used for filesystem Unix-domain IPC. There is no HTTP parameter, environment override or browser field for this path.

The bridge has a 3-second local-connect deadline. Browser close/error or any bridge failure destroys the local socket and revokes the terminal capability.

## Protocol translation

Browser bytes are **not** raw-proxied.

After local connect, the server itself emits:

```json
{"v":1,"type":"open","cols":80,"rows":24}
```

Browser frames are rejected until the local worker sends exact `ready`.

After `ready`, the browser can send only the Phase 9F shapes:

```json
{"type":"input","data":"..."}
{"type":"resize","cols":80,"rows":24}
```

The server reparses these and emits the Phase 9H versioned NDJSON equivalents. Input remains capped at 2048 UTF-8 bytes; NUL input is now explicitly rejected so the browser and local contracts match. Resize remains cols 2..300 and rows 2..200.

The local worker can send only exact `ready`, `output`, `exit` and fixed `error` shapes. The server parses these again before creating browser frames.

## Backpressure and bounds

- inbound browser WebSocket payload: 4 KiB via `@fastify/websocket`;
- local server read event: max 64 KiB;
- one serialized local server frame: max 32 KiB;
- local PTY output data chunk accepted by bridge: max 4 KiB UTF-8;
- local pending write buffer hard cap: 64 KiB;
- browser WebSocket `bufferedAmount` hard cap: 64 KiB;
- browser outbound serialized frame hard cap: 32 KiB.

Crossing a hard cap fails closed and tears down both sides.

## Close classification

The bridge uses fixed close reasons only; it never reflects tokens, filesystem paths, native errors or terminal contents.

- policy/protocol/pre-ready/session-expiry: WebSocket 1008;
- local/PTY/internal bridge failure: 1011;
- output/backpressure overload: 1013;
- normal PTY exit: browser exit frame followed by 1000.

## Important non-goals / still absent

Phase 9I does **not**:

- create `dashboard-rpi5-terminal` or connector groups;
- add the web service to `dashboard-rpi5-terminal-client`;
- install/enable/start/restart `dashboard-rpi5-terminal.socket`;
- create a live Unix socket;
- run `node-pty` in `apps/server`;
- spawn shell/processes in `apps/server`;
- add Docker, journal, systemd-control or sudo privileges to `apps/server`;
- add xterm.js or a browser terminal UI;
- change Cloudflare Access/Tunnel/DNS;
- deploy production.

A future activation phase must separately verify the exact RPi5 execution identity, group membership, installed native binding, systemd units and end-to-end containment before enabling the socket. Frontend/xterm integration is also a separate phase.
