# Phase 2A — Local Agent Protocol

> Status: source implementation only. **Not installed, enabled, started, or deployed on the Raspberry Pi.**

## Purpose

Phase 2A creates the first narrow local trust boundary between the dashboard web/API process and future host reads.

```text
dashboard web/API
      |
      | future local client
      v
/run/dashboard-rpi5/agent.sock
      |
      v
dashboard-rpi5-agent
```

The agent currently exposes only:

```text
GET /v1/health
```

The response is versioned and schema-bound. It intentionally does not expose hostname, usernames, filesystem paths, environment variables, process arguments, Docker details, systemd state, logs, shell output, or credentials.

## Protocol contract

Current protocol:

```json
{
  "status": "ok",
  "service": "dashboard-rpi5-agent",
  "mode": "SOURCE_ONLY",
  "protocolVersion": 1,
  "agentVersion": "0.2.0",
  "capabilities": ["protocol.health"],
  "observedAt": "2026-08-15T13:00:00.000Z"
}
```

The capability list is explicit. A capability must not appear until its implementation and trust boundary have been reviewed.

## Unix socket contract

Default future path:

```text
/run/dashboard-rpi5/agent.sock
```

Rules:

- production entrypoint uses a Unix-domain socket only;
- no TCP listen mode is provided by the agent entrypoint;
- socket path must be absolute and may not contain a NUL byte;
- socket mode is narrowed to `0660` after bind;
- world-readable/world-writable socket modes are not used;
- the runtime directory must be controlled by the future service identity;
- tests always use a temporary socket under the CI temp directory.

### Stale socket handling

A crash can leave a Unix socket pathname behind. Cleanup is deliberately fail-closed:

1. `lstat` the configured path;
2. if it does not exist, continue;
3. if it is not a socket, stop and do not unlink it;
4. probe the socket;
5. if a server accepts the connection, stop with `SocketPathInUseError`;
6. if the socket is stale/refused, `lstat` it again;
7. verify the device/inode still match the originally inspected socket;
8. only then unlink it.

This prevents a normal file, symlink, active agent socket, or path replaced during the check from being silently deleted.

## Allowlisted operation registry

Phase 2A includes an internal registry primitive for future read operations.

Rules:

- operation IDs are registered in source code;
- malformed IDs are rejected;
- duplicate IDs are rejected;
- unknown IDs fail closed;
- operations receive an `AbortSignal`;
- default timeout is 5 seconds;
- maximum configured timeout is 30 seconds;
- client-facing error objects are normalized to bounded codes rather than raw error messages.

There is **no generic operation HTTP route in Phase 2A**. The registry is infrastructure for later narrowly scoped capabilities.

## Source-only systemd blueprint

`ops/systemd/dashboard-rpi5-agent.service` is documentation/source configuration only.

It is not authorization to:

- create a host user/group;
- copy the unit to `/etc/systemd/system`;
- run `systemctl daemon-reload`;
- enable/start/restart the service;
- create runtime directories manually;
- modify production permissions.

Those are host mutations and remain owner-gated by #1.

## Phase 2B boundary

The next phase may add read adapters for uptime, load, memory, root filesystem, Pi temperature and decoded throttling/under-voltage evidence.

Even after that source is merged, **first live RPi activation remains a separate explicit owner authorization**.

## Primary documentation checked

- Node.js 24 IPC / Unix sockets: https://nodejs.org/download/release/v24.16.0/docs/api/net.html
- Fastify server/listen contract: https://fastify.dev/docs/latest/Reference/Server/
- Raspberry Pi `vcgencmd`/health reference for the following phase: https://www.raspberrypi.com/documentation/computers/os.html
- Raspberry Pi temperature guidance: https://www.raspberrypi.com/documentation/computers/raspberry-pi.html
