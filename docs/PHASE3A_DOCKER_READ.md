# Phase 3A — Docker current-state read boundary

> Tracking issue: #9  
> Production activation: **not authorized**

## Purpose

Phase 3A adds a narrow source-only adapter that can project current Docker container state through the local agent after a later, separately authorized production permission change.

It does **not** grant the agent access to Docker in production.

## Why Phase 3 is split

The roadmap's Docker phase is split into two bounded implementation slices:

- **3A** — current inventory + inspect + one-shot resource stats;
- **3B** — bounded Docker event projection.

This keeps the first Docker Engine trust-boundary code small enough to audit without combining it with long-lived event streaming.

## Official documentation checked — 2026-08-15

Primary sources:

- Docker Engine API: https://docs.docker.com/reference/api/engine/
- Engine API v1.40: https://docs.docker.com/reference/api/engine/version/v1.40/
- Docker stats semantics: https://docs.docker.com/reference/cli/docker/container/stats/
- Docker Engine security: https://docs.docker.com/engine/security/
- Docker daemon socket protection: https://docs.docker.com/engine/security/protect-access/

Key conclusions:

1. Docker Engine exposes a versioned REST API and current engines retain backward-compatible API versions.
2. The current Docker documentation shows modern Engine releases with minimum supported API v1.40. The fields needed by this dashboard already exist in v1.40, so this slice intentionally pins requests to **v1.40**.
3. Docker normally uses a local Unix socket.
4. Access to the Docker daemon is a high-privilege trust boundary. Read-only intent at the HTTP method level does **not** make socket membership low privilege.
5. Therefore the dashboard agent must expose only purpose-built normalized read operations and must never expose a generic Engine proxy.

## Production transport contract

The implementation has one production Docker socket constant:

```text
/var/run/docker.sock
```

There is no browser-selected socket, Docker host, TCP port, SSH endpoint or TLS endpoint.

Phase 3A source is merged before any production permission is granted. A later activation preflight must prove the exact service identity, socket ownership/mode and supported API range before the owner can separately authorize first live Docker read access.

## Docker API allowlist

The source adapter recognizes only:

```text
GET /v1.40/_ping
GET /v1.40/version
GET /v1.40/containers/json?all=true
GET /v1.40/containers/<64-hex-id>/json
GET /v1.40/containers/<64-hex-id>/stats?stream=false
```

Container IDs used in inspect/stats requests must come from the daemon's own list response and pass strict 64-lowercase-hex validation.

The agent does not accept a Docker endpoint or arbitrary container path from browser input.

## Agent API

Purpose-built route:

```text
GET /v1/docker/containers
```

The route uses internal operation ID:

```text
docker.containers
```

The response is a normalized TypeBox contract, not a passthrough Docker response.

## Normalized evidence

Per container:

- full container ID;
- canonical name;
- image + image ID;
- creation timestamp;
- normalized state;
- structured health status;
- restart count;
- started timestamp and uptime for running containers;
- stats evidence state;
- CPU percentage;
- memory used/limit/percentage;
- network receive/transmit bytes;
- block read/write bytes;
- PID/thread count.

Snapshot-level metadata records:

- observation timestamp;
- requested API version (`1.40`);
- daemon Engine version;
- daemon maximum API version;
- daemon minimum API version.

## Resource semantics

### CPU

Docker documents:

```text
cpu_delta = cpu_stats.cpu_usage.total_usage - precpu_stats.cpu_usage.total_usage
system_delta = cpu_stats.system_cpu_usage - precpu_stats.system_cpu_usage
CPU % = (cpu_delta / system_delta) * online_cpus * 100
```

Multi-core Docker CPU percentages can exceed 100%, so the Docker CPU contract does not use the host's 0–100 percentage ceiling.

Invalid or non-monotonic deltas become `null`; they are never rendered as fabricated `0%`.

### Memory

Docker documents Linux CLI cache subtraction as:

- cgroup v2: `inactive_file`;
- cgroup v1: `total_inactive_file`;
- older compatibility fallback: `cache`.

The adapter uses that priority. If required evidence is inconsistent, the affected metric becomes unavailable rather than healthy-looking.

### Network

RX/TX are summed across the interfaces returned by the Docker stats payload.

### Block I/O

Read/write bytes are summed from authoritative `io_service_bytes_recursive` read/write entries when present. Missing block-I/O evidence remains `null`.

### PIDs

`pids_stats.current` is projected when present. Docker notes that this number includes processes and kernel threads.

## Partial stats failure

Container inventory/inspect evidence and live stats are deliberately separated.

For a running container:

```text
stats success -> statsState = AVAILABLE
stats failure -> statsState = UNAVAILABLE, stats = null
```

For a stopped container:

```text
statsState = NOT_RUNNING
stats = null
```

A single unavailable stats response does not fabricate zeros and does not discard otherwise valid inventory evidence.

## Bounds

Source constants:

- request timeout: 1500 ms per Docker request;
- response-size cap: 1 MiB per request;
- container concurrency: 4;
- maximum normalized inventory: 512 containers;
- GET-only endpoint allowlist.

The outer agent operation timeout remains independently bounded by the agent operation registry.

## Explicit non-capabilities

Phase 3A does not implement or authorize:

- Docker group membership;
- socket ACL/group changes;
- TCP Docker API;
- generic Engine proxying;
- events;
- logs;
- exec/attach/top;
- container create/start/stop/restart/kill/remove/update;
- image pull/build/prune;
- volume/network mutation;
- production systemd activation;
- Cloudflare changes;
- any dashboard write capability.

## Activation gate

After this source slice is merged and exact-main CI passes, **first live Docker read permission remains a separate owner-gated operation** under `AGENTS.md`.

Before that authorization, production must not gain access to `/var/run/docker.sock`.

**Production deploy: NO.**
