# Phase 6B — Public endpoint health

Phase 6B turns the existing Phase 5C-E structured endpoint transition evidence into a compact read-only Overview status surface.

## Boundary

The dashboard does **not** probe public URLs in this phase and does not connect to the Uptime Kuma API or database.

The existing agent boundary remains authoritative:

- fixed evidence path: `/var/lib/dashboard-rpi5/evidence/endpoints.json`;
- fixed agent route: `GET /v1/endpoints/events/recent`;
- bounded root-owned regular-file read with `O_NOFOLLOW`;
- no browser-provided path, URL, monitor ID, timeout or probe selector.

The live evidence producer is still deferred and is not created or activated by this phase.

## Browser-safe status model

The server exposes one purpose-built route:

`GET /api/endpoints`

The route accepts no query parameters and returns only:

- endpoint ID;
- safe display label;
- current known state;
- last transition time;
- optional HTTP status code already present in evidence;
- optional latency already present in evidence.

It never returns probe URLs, request headers, credentials, cookies, response bodies, Uptime Kuma secrets, source paths, or arbitrary monitor configuration.

## Current-state derivation

The evidence stream is newest-first. The server keeps only the newest transition for each distinct endpoint ID and treats that transition's `toState` as the current **known** state inside the bounded evidence window.

The public surface supports at most eight distinct endpoint IDs. If the evidence contains more than eight distinct IDs, the server fails closed as `SOURCE_UNAVAILABLE` instead of silently truncating a potentially important outage. The eventual producer therefore owns curation of the high-value endpoint set.

Future-dated transition evidence also fails closed.

## Health semantics

- any current `DOWN` or `DEGRADED` => `ATTENTION`;
- any current `UNKNOWN` with no outage => `UNKNOWN`;
- empty current evidence => `UNKNOWN`;
- all current endpoints `UP` => `HEALTHY`;
- source failure => HTTP 503 `SOURCE_UNAVAILABLE` / UI unknown.

Missing or malformed evidence is never converted into healthy-looking zero state.

## Overview UX

Overview receives one compact Public Endpoints card. It shows the bounded current endpoint list and keeps outage rows visually prominent. The card links to Activity for transition-history drill-down.

A Uptime Kuma history deep link is intentionally deferred until there is a reviewed browser-safe endpoint-to-monitor mapping. Phase 6B does not copy every Kuma monitor or widget into the dashboard.

## Validation

Phase 6B is covered by:

- strict normalized status contract and health-correlation tests;
- newest-transition-per-endpoint derivation tests;
- over-eight and future-evidence fail-closed tests;
- strict empty-query API tests;
- secret/path/URL non-exposure assertions;
- responsive Overview browser tests across the existing A55/mobile/landscape/desktop matrix;
- outage -> attention and unavailable/empty -> unknown regressions;
- 320 CSS px horizontal-overflow checks.

## Deployment status

Source implementation only.

**Production deploy: NO.**

No Cloudflare, systemd, Uptime Kuma, host permissions, evidence producer, or live monitoring configuration is changed by Phase 6B.
