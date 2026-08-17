# Phase 3C — bounded Docker read broker

Issue: #119

## Goal

Restore live Docker **current-state** evidence without granting the main `dashboard-rpi5-agent` direct access to `/var/run/docker.sock` and without adding that agent to the `docker` group.

Docker Engine socket authority is treated as a separate high-trust boundary. The dashboard-facing agent remains a bounded consumer.

## Architecture

```text
web/server
    |
    v
/run/dashboard-rpi5/agent.sock
    |
    v
dashboard-rpi5-agent
  groups:
    - dashboard-rpi5-agent-client (primary)
    - dashboard-rpi5-docker-broker-client (supplementary)
    |
    | fixed typed broker calls only
    v
/run/dashboard-rpi5-docker-broker/broker.sock
    |
    v
dashboard-rpi5-docker-broker
  primary group: dashboard-rpi5-docker-broker-client
  supplementary group: docker
    |
    | hard-coded GET operations only
    v
/var/run/docker.sock
```

The main agent has no generic Docker URL/path transport. It exposes typed broker capabilities only:

- ping;
- daemon version;
- list all containers;
- inspect an exact lowercase 64-hex container ID returned by the list operation;
- one-shot stats (`stream=false`) for such an exact ID.

The broker route parser has no caller-controlled Docker Engine path forwarding and rejects mutation routes, query injection, traversal, malformed IDs, request bodies, and non-GET methods.

## Bounds

The source contract fixes or caps:

- Docker API version: `1.40`;
- Engine request timeout: `1500 ms`;
- broker-client request timeout: `1500 ms`;
- response size: `1 MiB`;
- current-state per-container concurrency: `4`;
- broker concurrent Engine operations: `8`;
- broker request-target size: `256` bytes;
- broker transport: Unix socket only, no TCP listener.

Malformed, unavailable, timed-out, or oversized evidence fails closed. The dashboard must never substitute fixture/default container values.

## Docker events are intentionally excluded

`/v1/docker/events/recent` previously had its own direct Docker Unix-socket transport. That direct authority is removed in this phase.

The Phase 3C broker does **not** expose Docker `/events` because #119's reviewed capability allowlist covers only ping/version/list/inspect/stats. The default Docker event reader therefore remains explicit unavailable until a separate bounded events design is reviewed and implemented.

This is intentional privilege minimization, not a regression to fixture data.

## systemd source-only blueprint

`ops/systemd/dashboard-rpi5-docker-broker.service` is a source-only blueprint. It defines a dedicated broker identity and is the only Dashboard unit permitted to inherit the `docker` supplementary group.

The main agent blueprint receives only `dashboard-rpi5-docker-broker-client`. It must never inherit `docker` or `video`.

The broker blueprint includes local-only `AF_UNIX` restriction, empty capability sets, `NoNewPrivileges`, filesystem/kernel/control-group protections, namespace restrictions, bounded tasks/memory, and a private runtime directory.

## Production boundary

Nothing in #119 authorizes host installation or activation.

After merge and exact-main CI, production still requires a separate explicit owner-authorized gate to create/verify the dedicated identity/group, install the unit/configuration, activate the broker, update the running agent membership/configuration, restart the minimum required services, and prove live Docker evidence.

That future gate must preserve:

- main agent not in `docker`;
- main agent not in `video`;
- Quick Commands disabled;
- terminal/PTTY absent/fail-closed;
- Cloudflare Access/Tunnel/DNS unchanged;
- rollback/recovery only under its own explicit authorization semantics.
