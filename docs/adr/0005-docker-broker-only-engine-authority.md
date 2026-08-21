# ADR-0005 — Dedicated bounded Docker broker is the sole Docker Engine authority

**Status:** Accepted  
**Date:** 2026-08-21

## Context

Docker daemon access is effectively host-level authority even when an individual request is intended to be read-only. The original Phase 3 source design placed Docker Engine access inside the main `dashboard-rpi5-agent`, but the accepted production architecture now separates that authority into a dedicated bounded broker.

The current production/security invariant is:

```text
Browser / web API
  -> dashboard-rpi5-agent
  -> typed bounded Docker broker capabilities
  -> dashboard-rpi5-docker-broker
  -> /var/run/docker.sock
```

The main agent has no persistent `docker` or `video` membership. The browser and web/API process never receive Docker socket authority.

## Decision

`dashboard-rpi5-docker-broker` is the **only dashboard component permitted to own Docker Engine Unix-socket authority**.

The main agent communicates with the broker over the fixed filesystem Unix socket:

```text
/run/dashboard-rpi5-docker-broker/broker.sock
```

The broker protocol is capability-oriented, not a generic HTTP/Docker proxy. Current bounded capabilities cover:

- broker health;
- Docker ping/version evidence;
- container inventory;
- inspect/stats for validated 64-hex container IDs;
- allowlisted registered Docker logs and ranges;
- bounded recent Docker events with a maximum one-hour internal window.

Unknown paths, unsupported log source/range combinations, invalid container IDs, malformed event windows and capability widening fail closed.

## Invariants

- the main `dashboard-rpi5-agent` must never regain direct `/var/run/docker.sock` access;
- the main agent must never gain persistent `docker` membership merely to read Docker evidence;
- the web/API process and browser must never receive Docker Engine credentials or socket access;
- there is no generic Engine endpoint proxy;
- browser input cannot choose a Docker host, socket path or arbitrary Engine endpoint;
- Docker current-state, logs and recent events remain purpose-built normalized read capabilities;
- Docker mutation authority is not created by this broker;
- terminal/PTTY remains a separate execution boundary and must not inherit Docker authority.

## Data ownership versus transport

Docker Engine remains the authoritative owner of container runtime state, lifecycle events and Docker logs. The broker changes the **transport and trust boundary**, not the source of record.

## Historical records

`docs/PHASE3A_DOCKER_READ.md` and `docs/PHASE3B_DOCKER_EVENTS.md` preserve the original direct-Engine design and first-live trust-boundary rationale. They are historical design records and must not be interpreted as the current production transport model.

## Consequences

- one extra local process and Unix-socket hop;
- materially smaller Docker authority surface;
- the main agent can remain outside the `docker` group;
- Docker capabilities can be reviewed and bounded independently;
- current architecture documentation must show `agent -> broker -> Engine`, not `agent -> Engine`;
- any future Docker write capability would require a new explicit architecture/security decision and separate owner authorization.
