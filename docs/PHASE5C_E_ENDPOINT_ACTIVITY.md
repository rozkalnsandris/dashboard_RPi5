# Phase 5C-E — Structured endpoint-state Activity

Phase 5C-E adds an **endpoint transition evidence consumer** to Activity without adding a second active monitor.

## Why this source exists

The product contract names normalized endpoint availability, optionally backed by Uptime Kuma, as the authoritative source domain. The repository currently has no browser-safe, credential-free, repo-managed Uptime Kuma API/DB contract that the dashboard agent can consume without expanding production trust.

Therefore this phase deliberately does **not**:

- probe public URLs directly;
- read the Uptime Kuma SQLite database;
- add Uptime Kuma credentials or service tokens;
- scrape a private Kuma API;
- infer endpoint state from DNS, Cloudflare, HTTP logs or container health;
- mutate Uptime Kuma or Cloudflare configuration.

A future separately authorized producer may project authoritative monitor transitions into the fixed evidence contract below.

## Fixed evidence path

```text
/var/lib/dashboard-rpi5/evidence/endpoints.json
```

The dashboard agent opens the file with `O_NOFOLLOW` and requires:

- a regular file;
- root ownership by default;
- no group/world write bits;
- bounded file size;
- strict JSON schema with no unknown keys.

Missing, unsafe, malformed or oversized evidence becomes `SOURCE_UNAVAILABLE`. There is no fallback probe.

## Producer contract

Schema literal:

```text
dashboard-rpi5.endpoint-evidence.v1
```

Example only:

```json
{
  "schema": "dashboard-rpi5.endpoint-evidence.v1",
  "events": [
    {
      "eventId": "tech-down-20260815T195100Z",
      "endpointId": "tech",
      "label": "Hermes Tech",
      "occurredAt": "2026-08-15T19:51:00Z",
      "fromState": "UP",
      "toState": "DOWN",
      "statusCode": 503,
      "latencyMs": 1500
    }
  ]
}
```

Allowed states are `UP`, `DOWN`, `DEGRADED`, and `UNKNOWN`. `fromState` and `toState` must differ. Timestamps require an explicit RFC3339 timezone. IDs and labels are bounded and control characters are rejected. HTTP status and latency are optional normalized evidence, never used as hidden fallback classifiers.

The consumer accepts at most 64 unique transition IDs and normalizes them newest-first.

## Agent/API boundary

Fixed agent operation:

```text
endpoint.events.recent
```

Fixed local route:

```text
GET /v1/endpoints/events/recent
```

The route accepts an empty query only. Browser-like selectors such as `url`, `path`, `endpoint`, `source`, or `since` are rejected by schema rather than forwarded to the host.

The server uses the existing bounded Unix socket transport at `/run/dashboard-rpi5/agent.sock` and validates the complete endpoint evidence snapshot again before Activity normalization.

## Activity normalization

Endpoint transitions become:

- source: `ENDPOINT`;
- kind: `ENDPOINT_STATE`;
- target: `/` (Overview / Public Endpoints area);
- `DOWN` => `CRITICAL`;
- `DEGRADED` => `ATTENTION`;
- `UNKNOWN` => `ATTENTION`;
- `UP` => `INFO`.

Activity text is built only from normalized endpoint ID, label, old/new state, optional status code and optional latency. No raw URL, monitor secret, database path or private error text is exposed.

Activity now has six independent source states:

```text
DOCKER
SYSTEMD
BACKUP
MAINTENANCE
DEPLOY
ENDPOINT
```

Any subset may be unavailable while valid evidence from other sources remains visible. Only all six unavailable produces the top-level `SOURCE_UNAVAILABLE` state.

## Browser behavior

The Activity page adds an `Endpoints` source filter. Filtering remains local; the browser still issues only the selector-free `/api/activity` request. Endpoint events deep-link to Overview rather than to a new arbitrary URL.

The existing Samsung Galaxy A55/mobile/desktop Playwright matrix remains the automated UI gate.

## Activation boundary

This source change does **not** create `/var/lib/dashboard-rpi5/evidence/endpoints.json` on the Pi and does not install any producer.

A later producer/host activation phase must separately define:

- the authoritative source (for example an Uptime Kuma projection);
- how transitions are obtained without weakening Kuma authentication;
- atomic file publication;
- root ownership and file mode;
- retention/event ID behavior;
- host/service lifecycle;
- rollback and verification.

That activation is a production trust-boundary change and requires explicit owner authorization.

**Production deploy: NO.**
