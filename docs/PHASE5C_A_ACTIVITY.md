# Phase 5C-A — Activity timeline core

Phase 5C-A replaces the Phase 1 Activity fixtures with a bounded read-only timeline backed only by structured Docker and allowlisted systemd evidence.

## Browser API

The browser has one route:

- `GET /api/activity`

It accepts no query parameters. Source and severity filters are client-side over the bounded validated snapshot. The response is `Cache-Control: no-store`.

There is no browser-controlled Docker filter, container selector, systemd unit, filesystem path, command, executable or timestamp.

## Docker evidence

Activity reuses the existing Phase 3B agent route:

- `GET /v1/docker/events/recent`

The dashboard server reaches this route over the fixed local agent Unix socket with a fixed path, bounded deadline and response byte ceiling. The full response is validated before normalization.

The agent remains the owner of Docker Engine access, the v1.40 API binding, the fixed one-hour lookback and the allowed container-event actions. Phase 5C-A does not add another Docker socket reader.

Docker severity is deterministic:

- `OOM`, unhealthy health evidence and non-zero `DIE` are `CRITICAL`;
- restart/kill/die/stop/pause/destroy are `ATTENTION` unless stronger evidence applies;
- normal create/start/unpause/healthy/rename/update evidence is `INFO`;
- unknown or starting health evidence is `ATTENTION`.

The server may group repeated events only when the normalized container identity and action evidence match and the events occur within the fixed five-second burst window. Unrelated events are never collapsed. The grouped item retains the newest event timestamp and an explicit `groupCount`.

## systemd evidence

Activity reuses the existing Phase 5A `SystemdServicesSnapshot` contract. The service reader already obtains source-owned allowlisted units through fixed `systemctl show` properties and derives `stateAgeSeconds` from monotonic transition evidence.

For the timeline, the server derives the latest transition time as:

`services.observedAt - service.stateAgeSeconds`

A `null` state age produces no Activity item. Phase 5C-A does not parse journal prose and does not invent older service history.

Systemd severity is deterministic:

- failed service state is `CRITICAL`;
- non-active, non-loaded, masked or unknown evidence is `ATTENTION`;
- loaded + active evidence is `INFO`.

## Partial source behavior

The Activity response contains availability metadata for both `DOCKER` and `SYSTEMD`.

- if both sources are available, both contribute timeline items;
- if exactly one source fails, the valid source remains visible and the failed source is marked `UNAVAILABLE`;
- if both sources fail, `/api/activity` returns `SOURCE_UNAVAILABLE`;
- missing evidence is never represented as an empty healthy source.

Items are deduplicated by stable normalized identity, sorted newest-first and capped at 256 total entries.

## Browser behavior

The Activity page provides:

- five-second visible-only bounded refresh;
- source filter: All / Docker / Services;
- severity filter: All / Info / Attention / Critical;
- exact evidence timestamp, source, severity, title and detail;
- explicit grouped-event count;
- local links to the Docker or Services dashboard page;
- explicit Loading, Degraded, Empty and Unavailable states;
- responsive behavior across the existing 320px, Samsung A55-class portrait/landscape and desktop matrix.

Severity is always present as text and is not conveyed by color alone.

## Deliberately absent categories

### Backup

The current authoritative backup runner writes log timestamps as host-local bracketed values without an explicit timezone offset. Phase 5C-A does not silently promote those strings into precise cross-source timeline timestamps. A later Activity slice must first define a structured backup status/timestamp contract.

### Endpoint, deployment and maintenance

Operational ownership exists elsewhere in `RPi5_main`, but dashboard_RPi5 does not yet have reviewed bounded read-only adapters for those timestamp domains. They remain absent instead of being represented by fixtures or guessed text parsing.

## Activation boundary

Merging Phase 5C-A source does not authorize production activation. It does not change Docker socket permissions, journal/systemd permissions, agent installation, service units, host files, containers, Cloudflare, DNS or Access.

**Production deploy: NO.**
