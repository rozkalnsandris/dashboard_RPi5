# Architecture

## Final hostname

The human-facing application is **`https://dash.rozkalns.net`**.

## Chosen topology

For this single-host product, the preferred first architecture is deliberately simpler than a cloud-hosted hub/remote-agent system while keeping the full terminal in a separate local execution boundary:

```mermaid
flowchart LR
    B[Browser / phone]
    A[Cloudflare Access]
    T[Cloudflare Tunnel]
    W[dashboard web + API\nloopback on RPi5]
    X[local privileged-read agent\nUnix socket]
    Y[isolated terminal session\nsystemd socket activation]
    D[Docker Engine\nUnix socket]
    J[systemd + journal]
    R[vcgencmd + /proc + sysfs]
    P[Prometheus]
    G[Grafana]
    S[normal-user PTY]

    B --> A --> T --> W
    W --> X
    W -. later terminal bridge .-> Y
    X --> D
    X --> J
    X --> R
    Y --> S
    W --> P
    W -. deep link .-> G
```

### Why this topology

- no inbound router port;
- no second Internet-facing agent hostname;
- the dashboard frontend/API can remain unprivileged;
- the privileged-read helper is not network-exposed;
- the terminal runtime does not inherit Docker/journal/host-read privileges from that helper;
- terminal WebSocket does not require an additional cloud relay;
- easy to deploy and debug on one Pi;
- later we can externalize/cache last-known status if Pi-offline visibility becomes a real requirement.

## Processes

### `dashboard-rpi5-web`

Responsibilities:

- serve React/Vite assets;
- authenticated normalized API;
- query Prometheus for historical metrics;
- communicate with local helpers only through narrow Unix-socket protocols;
- enforce request validation and response shaping;
- host the authenticated terminal WebSocket gateway only after the terminal phase is authorized.

Must not:

- execute arbitrary shell commands itself;
- receive Docker socket directly;
- load `node-pty`;
- run as root.

### `dashboard-rpi5-agent`

Host-side privileged-read systemd service.

Responsibilities:

- Raspberry Pi temperature/throttle state;
- safe `/proc`/sysfs reads;
- Docker current stats/events/logs through the local Engine socket;
- allowlisted systemd state and journal queries;
- registered backup/deploy evidence;
- registered Quick Commands when separately authorized.

Recommended transport:

```text
/run/dashboard-rpi5/agent.sock
```

Permissions should allow only the dashboard web service identity to connect.

The read agent must not load `node-pty` or host the free-form shell. This avoids a terminal process inheriting future Docker/journal/host-read group privileges.

### `dashboard-rpi5-terminal-agent`

Separate local execution boundary for the future full terminal.

Phase 9G created the native module/build boundary. Phase 9H adds a source-only local protocol and systemd containment blueprint, but still does **not** connect the browser-facing WebSocket to the PTY.

Required properties:

- Linux only;
- dedicated non-root execution identity;
- no privileged supplementary groups;
- no Docker socket or journal privilege;
- no automatic sudo/elevation;
- fixed server-side shell contract;
- minimal fresh environment rather than inherited service secrets;
- one bounded PTY session at a time;
- local Unix socket only;
- one accepted connection maps to one systemd service instance/cgroup;
- no writable delegated cgroup subtree;
- PID 1 owns final process-tree cleanup through `KillMode=control-group`;
- application 5-minute idle / 30-minute absolute lifetime plus independent systemd `RuntimeMaxSec=30min`.

Source-only transport target:

```text
/run/dashboard-rpi5-terminal.sock
```

The socket uses `Accept=yes`, `MaxConnections=1`, mode `0660`, and a dedicated `dashboard-rpi5-terminal-client` connector group. Each accepted connection launches `dashboard-rpi5-terminal@.service` with the connection attached to stdin/stdout. The service runs the `session-stdio-entry` worker and the Phase 9G native PTY under the same systemd cgroup.

The service is intentionally not cgroup-delegated. `ProtectControlGroups=yes` keeps cgroup management away from the shell, while service teardown uses `KillMode=control-group`, `SendSIGKILL=yes` and a short stop timeout so detached descendants cannot survive ordinary worker exit. A 30-minute systemd runtime limit is an independent backstop.

The exact production users/groups, socket-group membership, unit installation and activation remain owner-gated production decisions and are not performed by source merges.

## Browser-facing API

```text
GET  /api/health
GET  /api/rpi/summary
GET  /api/rpi/docker
GET  /api/rpi/docker/:containerId
GET  /api/rpi/services
GET  /api/rpi/activity
GET  /api/rpi/backups
GET  /api/rpi/deployments
GET  /api/rpi/logs?sourceId=...
GET  /api/rpi/logs/stream?sourceId=...
POST /api/rpi/quick-command             # gated
POST /api/terminal/session              # implemented, production-disabled by default
WS   /api/terminal/ws                   # authenticated transport; PTY bridge still gated
```

## Read-agent interface

Purpose-built operations only; no arbitrary method/proxy endpoint.

```text
GET  /v1/health
GET  /v1/summary
GET  /v1/docker
GET  /v1/docker/:id
GET  /v1/services
GET  /v1/activity
GET  /v1/backups
GET  /v1/logs
GET  /v1/logs/stream
POST /v1/quick-command                  # registered IDs only
```

There is intentionally no free-form terminal endpoint on the privileged-read agent.

## Terminal-agent local protocol

The contained session worker reads newline-delimited JSON from its socket-backed stdin and writes only bounded protocol frames to socket-backed stdout.

The first client frame must be exactly:

```json
{"v":1,"type":"open","cols":80,"rows":24}
```

After `ready`, the only accepted client message types are bounded `input`, bounded `resize`, and `close`. There is no command/executable/argv/cwd/env/uid/gid field in this protocol. Malformed, oversized, duplicate-open or unknown messages fail closed.

PTY output is treated as untrusted data, is capped per native callback, split into bounded Unicode-safe chunks and written through a bounded backpressure queue. Terminal frame contents are not persisted or logged.

Phase 9H still has no `apps/server` client for this socket. Joining the authenticated Phase 9E WebSocket to this local protocol is a later security phase.

## Data ownership

- Prometheus owns time-series history.
- Grafana owns deep visual analysis.
- Docker Engine owns container runtime state/events/logs.
- systemd journal owns host service logs.
- dashboard owns presentation, alert projection and minimal local UI state only.

Do not create a second metrics database merely to draw the same CPU/RAM charts.

## Deployment

Target first web deployment shape:

```text
cloudflared -> 127.0.0.1:<dashboard-port>
```

Cloudflare Access protects `dash.rozkalns.net` before public use.

The exact tunnel/DNS/Access mutation, terminal-agent user/group creation, socket/service installation, execution identity and activation are separate owner-authorized production steps.
