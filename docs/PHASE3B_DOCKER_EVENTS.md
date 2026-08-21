# Phase 3B — Docker recent-events boundary

> **Historical design record — current Docker transport superseded.**  
> This document preserves the original Phase 3B direct-Engine design. The accepted current path keeps the public agent route bounded while the agent obtains Docker event evidence through the dedicated broker: `dashboard-rpi5-agent -> bounded Docker broker -> Docker Engine`. The main agent has no direct Docker socket authority or persistent `docker` membership. See [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`adr/0005-docker-broker-only-engine-authority.md`](adr/0005-docker-broker-only-engine-authority.md). The historical design below is intentionally retained rather than rewritten.

Status: source-only implementation for issue #11.

## Purpose

Phase 3B adds a bounded recent container-event projection behind the local agent. It is intentionally **not** a generic Docker events proxy and is not a live browser stream.

Agent route:

```text
GET /v1/docker/events/recent
```

The route accepts no query parameters in Phase 3B.

## Authoritative Docker contract

Primary documentation checked on 2026-08-15:

- Docker Engine API: https://docs.docker.com/reference/api/engine/
- Docker Engine API v1.40 `GET /events`: https://docs.docker.com/reference/api/engine/version/v1.40/
- Docker system events: https://docs.docker.com/reference/cli/docker/system/events/

Docker documents `since`, `until` and JSON filters for the event stream, and documents that only the last 256 stored events are returned. Container event types include create/destroy/die/health_status/kill/oom/pause/rename/restart/start/stop/unpause/update among other lower-value events.

## Fixed request boundary

Production source is fixed to:

```text
socket: /var/run/docker.sock
API:    v1.40
method: GET
path:   /v1.40/events
window: last 60 minutes through current server time
```

Filters are generated server-side only:

```json
{
  "type": ["container"],
  "event": [
    "create",
    "destroy",
    "die",
    "health_status",
    "kill",
    "oom",
    "pause",
    "rename",
    "restart",
    "start",
    "stop",
    "unpause",
    "update"
  ]
}
```

Browser input cannot choose timestamps, filters, container IDs, socket paths, hosts or Docker endpoints.

## Stream handling

The Engine response is treated as an untrusted bounded JSON-lines stream.

The adapter:

- decodes UTF-8 safely across arbitrary chunk boundaries;
- caps the total response at the existing 1 MiB Docker response limit;
- uses a 2.5 second request timeout;
- rejects malformed JSON lines fail-closed;
- accepts at most the normalized newest 256 events;
- ignores unsupported event actions even if Docker returns them unexpectedly;
- ignores non-container objects even if filters are not honored;
- does not forward arbitrary `Actor.Attributes`.

## Normalized public fields

Only these fields leave the agent boundary:

```text
occurredAt
action
containerId
containerName | null
image | null
health | null
exitCode | null
signal | null
scope
```

`timeNano` is used only when JavaScript can represent it as a safe integer. Current epoch nanoseconds are normally above JavaScript's safe-integer range, so the adapter safely falls back to Docker's integer-second `time` field rather than inventing sub-second precision.

Health actions accept both `health_status` and Docker action strings carrying a status suffix, such as `health_status: unhealthy`.

Exact duplicate normalized events are de-duplicated and the result is sorted newest-first.

## Error semantics

- empty bounded window -> valid `events: []`;
- whole Docker source failure -> `SOURCE_UNAVAILABLE`;
- malformed required event identity/timestamp -> `SOURCE_UNAVAILABLE`;
- unsupported event action -> ignored;
- no raw daemon body, socket path, stack trace or arbitrary actor attributes are returned.

## Explicitly not activated

This source change does not authorize or perform:

- `/var/run/docker.sock` permission changes;
- Docker group/ACL changes;
- RPi5 agent activation;
- systemd install/enable/restart;
- live SSE/WebSocket Docker event streaming;
- Docker logs;
- container mutation;
- generic Engine proxying;
- Cloudflare/DNS/Tunnel/Access changes;
- production deployment.

First live Docker read permission remains a separate owner gate.

**Production deploy: NO.**
