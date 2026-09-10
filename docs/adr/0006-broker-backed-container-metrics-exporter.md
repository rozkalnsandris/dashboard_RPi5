# ADR-0006 — Broker-backed exporter for historical container metrics

**Status:** Accepted  
**Date:** 2026-09-10  
**Decision issue:** #267  
**Parent backlog:** #247

## Context

Issue #265 established that per-container history belongs in Prometheus but found no existing production container-metrics series. It also preserved ADR-0005: `dashboard-rpi5-docker-broker` is the only dashboard component permitted to own Docker Engine Unix-socket authority.

A conventional cAdvisor Docker deployment commonly obtains container metadata through Docker daemon access. Giving a second collector `/var/run/docker.sock`, Docker-group authority or Docker TCP credentials would create another Engine authority path and violate the accepted boundary.

A sanitized read-only identity check recorded in #267 observed 20 running containers at that point in time: 19 had a complete and unique Docker Compose `project/service/container-number` tuple and one had none of those selected labels. That evidence is historical provenance only and must not be treated as current runtime truth for a future activation.

## Decision

Historical container metrics will use a **broker-backed Prometheus exporter**.

The intended data flow is:

```text
Prometheus
  -> bounded container-metrics exporter
      -> fixed typed broker capability
          -> dashboard-rpi5-docker-broker
              -> Docker Engine Unix socket
```

The exporter is not a Docker authority. It must not receive:

- `/var/run/docker.sock` or another Docker socket mount;
- persistent `docker` group membership;
- Docker TCP credentials;
- arbitrary Docker host/endpoint/path selection;
- a generic Engine proxy;
- Docker mutation capability.

ADR-0005 remains unchanged: `dashboard-rpi5-docker-broker` is the sole Docker Engine Unix-socket authority.

This ADR selects the architecture only. The fixed broker metrics capability, exporter executable/service, Prometheus scrape configuration and production activation are **not implemented or authorized by #267**.

## Exporter/broker contract

A future implementation must add a purpose-built broker capability that returns only the typed evidence needed by the exporter. It must be bounded by timeout, response size and concurrency, and it must fail closed on malformed or unsupported data.

The capability may expose only the reviewed material required to derive these Prometheus families:

- `container_cpu_usage_seconds_total` — cumulative CPU counter;
- `container_memory_working_set_bytes` — working-set gauge;
- `container_network_receive_bytes_total` — cumulative receive counter;
- `container_network_transmit_bytes_total` — cumulative transmit counter;
- `container_fs_reads_bytes_total` — cumulative read counter;
- `container_fs_writes_bytes_total` — cumulative write counter.

Per-CPU, interface and device dimensions may exist inside the bounded evidence path but must be aggregated away by reviewed server-owned queries so each public metric resolves to one logical series per container.

The broker capability must not become a generic Docker API transport. Environment variables and arbitrary Docker labels are outside the contract.

## Stable logical identity

The primary historical identity is the Docker Compose tuple:

```text
com.docker.compose.project
com.docker.compose.service
com.docker.compose.container-number
```

All three components are required. They must be validated and bounded before metric-label emission. The logical identity is the tuple, not a runtime Docker container ID.

Recreate continuity follows the tuple: a recreated container with the same validated tuple represents the same logical history identity. A raw container ID or container name must never be used as an automatic continuity fallback.

If a running container has a missing, partial, malformed or duplicate Compose tuple, its historical metrics are `UNAVAILABLE` unless a separate explicit static mapping exists. Any static mapping must be server-owned, source-reviewed and bounded; it cannot be supplied dynamically by the browser or discovered through an arbitrary label rule.

## Prometheus and browser boundary

Prometheus remains the time-series authority. The exporter is only an internal scrape source.

The eventual scrape surface must not be publicly exposed. The dashboard browser must not receive collector access, raw collector labels, arbitrary PromQL, arbitrary label matchers, arbitrary time ranges or collector URLs. Dashboard history queries remain fixed and server-owned.

## Alternatives considered

### cAdvisor with Docker Engine authority

Not selected under the current architecture because a Docker socket mount/connection would create a second Engine authority path. Reconsidering that path requires a separate ADR/security/owner decision that explicitly amends the current authority model.

### Container name or Docker ID continuity

Not selected. Names can be operationally meaningful but are not accepted as an automatic recreate identity contract; Docker IDs are explicitly ephemeral across recreation.

### Separate metrics database

Not selected. Prometheus remains the long-history authority and no duplicate dashboard TSDB is introduced.

## Consequences

- Docker Engine authority remains concentrated in the existing broker.
- A future exporter adds a bounded read-only process but no second Docker privilege owner.
- The future broker metrics capability must be designed and tested before activation.
- Containers without accepted identity fail closed to `UNAVAILABLE` rather than silently merging or fabricating history.
- Before LIVE activation, fresh read-only evidence must re-prove metric semantics, identity uniqueness, cardinality, scrape health, retention/capacity and unchanged Docker authority.
- Any exporter deployment, broker runtime update, Prometheus scrape mutation, systemd/container change, permission change or restart remains separately owner-authorized LIVE work.

**Production deploy: NO for this architecture-decision source change.**
