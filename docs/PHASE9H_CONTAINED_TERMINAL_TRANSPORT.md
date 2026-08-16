# Phase 9H — systemd-contained terminal session transport

Status: source-only implementation for issue #63. No systemd unit is installed or active and no browser/server path can reach the PTY.

## Why systemd owns containment

Phase 9G proved the fixed native PTY adapter on x64 and ARM64 but deliberately stopped because a direct `node-pty.kill()` only signals the PTY shell PID. An interactive shell can create detached descendants, so PID-only cleanup is not a sufficient terminal security boundary.

Phase 9H also rejects a raw writable delegated-cgroup design. If the terminal manager and interactive shell use the same Unix identity, giving that identity a writable delegated cgroup subtree would let shell code manipulate the same cgroup controls that are supposed to contain it.

The source-only blueprint therefore uses systemd socket activation:

```text
/run/dashboard-rpi5-terminal.sock
        |
        | Accept=yes
        v
dashboard-rpi5-terminal@<connection>.service
        |
        | one systemd service cgroup
        v
session-stdio-entry -> node-pty -> fixed bash
```

There is no `Delegate=` setting. The service has `ProtectControlGroups=yes` and systemd/PID 1 remains the cleanup authority.

## Socket boundary

`ops/systemd/dashboard-rpi5-terminal.socket` is a source-only blueprint with:

- filesystem Unix socket only: `/run/dashboard-rpi5-terminal.sock`;
- `SocketUser=root`;
- `SocketGroup=dashboard-rpi5-terminal-client`;
- `SocketMode=0660`;
- `Accept=yes`;
- `MaxConnections=1`;
- `Backlog=1`;
- `RemoveOnStop=yes`;
- one `dashboard-rpi5-terminal@.service` instance per accepted connection.

Membership in `dashboard-rpi5-terminal-client` is equivalent to permission to reach the local terminal execution boundary. Production membership must therefore be narrow and explicitly owner-authorized. Phase 9H does not create that group or add any user to it.

## Per-connection service containment

`dashboard-rpi5-terminal@.service` is a source-only template. It runs as the dedicated non-root `dashboard-rpi5-terminal` identity and requires no supplementary groups.

The accepted socket is attached to stdin/stdout. The worker does not open a network listener.

Important containment directives include:

- `KillMode=control-group`;
- `SendSIGKILL=yes`;
- `TimeoutStopSec=2s`;
- `RuntimeMaxSec=30min`;
- `ProtectControlGroups=yes`;
- no `Delegate=`;
- no `ExitType=cgroup`;
- `NoNewPrivileges=yes`;
- empty capability bounding and ambient sets;
- private network and tmp namespaces;
- strict system/home/kernel protection;
- namespace, SUID/SGID and realtime restrictions;
- `TasksMax=64` and `MemoryMax=256M`;
- Docker, system D-Bus and systemd private control sockets made inaccessible.

The unit intentionally uses the default main-process exit model rather than `ExitType=cgroup`: when the Node session worker exits after disconnect, close, expiry or failure, systemd tears the service down and kills processes still left in the service cgroup. `RuntimeMaxSec=30min` remains an independent backstop if the worker itself wedges.

## Local wire protocol

The session worker uses strict newline-delimited JSON. Raw client frames are limited to 4096 bytes and must be valid UTF-8 with an exact object shape.

The first frame must be:

```json
{"v":1,"type":"open","cols":80,"rows":24}
```

Before this valid `open`, the worker does not load the native PTY module.

After a successful open the worker returns:

```json
{"v":1,"type":"ready"}
```

Only these client frame types then exist:

- `input` — non-empty UTF-8 data, at most 2048 bytes, no NUL;
- `resize` — columns 2..300 and rows 2..200;
- `close` — no payload fields.

There is deliberately no protocol field for executable, command, argv, cwd, environment, UID/GID, shell path, signal or process ID.

Unknown versions/types, extra fields, malformed JSON, invalid UTF-8, oversized frames, duplicate `open` and incomplete EOF frames fail closed.

## Session lifecycle

The application layer has:

- 5 second open-handshake deadline;
- 5 minute idle deadline;
- 30 minute absolute deadline;
- idle refresh only for accepted input/resize, never PTY output;
- PTY kill on EOF/disconnect, close, protocol failure, PTY failure, idle expiry, absolute expiry or output overload.

The 30 minute systemd `RuntimeMaxSec` is deliberately redundant with the application absolute timer.

## Output and backpressure

PTY output is untrusted.

- one native `onData` callback may contain at most 64 KiB UTF-8;
- output is split on Unicode code-point boundaries into chunks of at most 4096 UTF-8 bytes;
- serialized server frames are bounded;
- queued output while stdout is backpressured is capped at 64 KiB;
- output overload fails closed and terminates the PTY;
- terminal output does not refresh idle time;
- frame contents are not persisted or logged.

## Still deliberately absent

- no system user/group creation;
- no unit installation, daemon reload, enable, start or restart;
- no live `/run/dashboard-rpi5-terminal.sock`;
- no `apps/server` Unix-socket client;
- no WebSocket-to-local-protocol bridge;
- no browser-visible PTY;
- no Cloudflare/Tunnel/DNS changes;
- no production environment values;
- no production deploy.

## Next gate

The next phase may implement the **server-side local client/bridge** that joins the already-authenticated one-time Phase 9E WebSocket claim to one Phase 9H local socket session. That bridge must preserve all 9A–9H lifetime, backpressure, authentication and cleanup invariants and remains source-only until separately reviewed.

Production installation/activation of the terminal service is a distinct owner authorization after source review.

**Production deploy: NO.**
