# Phase 4B — Overview history UI

Issue: #16

This source-only phase consumes the normalized Phase 4A host-history API in the React Overview. The browser is limited to the preset ranges `1h`, `24h`, and `7d`; it never accepts or constructs arbitrary PromQL, timestamps, upstream URLs, label matchers, or Grafana destinations.

## UI contract

- CPU %, memory %, root filesystem %, and load1 history cards.
- Compact SVG sparklines are decorative; visible latest/min/max values are the accessible numeric evidence.
- `UNAVAILABLE` is explicit and never rendered as zero.
- Loading and source-error states remain visible and fail closed.
- The Grafana deep link appears only when the server returns a non-null `grafanaHref`.
- Range controls are at least 44 px high and reflow at 320 CSS px.
- Polling is bounded to 60 seconds while the query has an active observer and is not continued in the background.
- No charting dependency is added for this compact presentation.

## Evidence boundary

Phase 4A remains the authority for the history response contract. Phase 4B does not add Docker/cAdvisor history or a second metrics database. Current Docker fixture data may remain elsewhere in the existing fixture Overview, but must not be presented as historical evidence.

## Explicitly out of scope

- production Prometheus/Grafana URL configuration;
- RPi5 agent activation;
- Docker socket/group/ACL mutation;
- systemd/journal activation;
- Cloudflare/DNS/Tunnel/Access changes;
- Quick Commands/PTTY activation;
- host/container/production writes.

**Production deploy: NO.**
