# Issue #196 — read-only evidence restoration contract

This document records the source integration between `dashboard_RPi5` and the authoritative host producer work in `rozkalnsandris/RPi5_main#212` / PR #215.

## Root cause boundary

The production failures observed for maintenance, deployments, backups, endpoints and Raspberry Pi throttle evidence are not a reason to widen `dashboard-rpi5-agent` authority.

The accepted architecture is:

```text
fixed authoritative root producers / fixed read-only host probes
  -> sanitized bounded evidence
  -> /var/lib/dashboard-rpi5/evidence/*.json
  -> strict dashboard agent readers
  -> existing browser-safe APIs
```

The dashboard agent must not gain persistent `video`, `docker`, `adm` or `systemd-journal` group membership for this restoration. Raw backup logs remain private and are not parsed by the dashboard.

## Evidence files

The integrated fixed paths are:

- `backups.json` — existing Phase 6A strict reader;
- `endpoints.json` — existing Phase 6B strict reader;
- `maintenance.json` — maintenance history default source;
- `deployments.json` — verified deployment history default source;
- `throttle.json` — Raspberry Pi throttle default source.

Every new reader requires an absolute fixed path, `O_NOFOLLOW`, a regular file, the expected owner, no group/world write bits, a bounded byte size and a strict schema. Missing, malformed or unsafe evidence fails closed.

Maintenance and deployment journal parsers remain covered as legacy diagnostic/test helpers, but they are no longer the runtime default source.

## Throttle freshness

`throttle.json` uses schema `dashboard-rpi5.throttle-evidence.v1` with only:

- `schema`;
- canonical UTC `observedAt`;
- lowercase bounded `rawHex`.

The agent accepts only non-future evidence at most ten minutes old. Missing, stale or malformed throttle evidence is represented by the existing `UNAVAILABLE` throttle state; it does not fabricate a healthy `0x0` value and does not fail otherwise available host metrics.

The future producer timer is designed for a two-minute cadence, so the ten-minute consumer budget tolerates a small number of missed collections while still making a stopped producer visibly unavailable.

## Docker and Prometheus

The Docker stats correction in this PR preserves the existing two-sample Engine API semantics while widening only the nested bounded request budgets supported by live evidence.

Prometheus was proven live on a reviewed private host binding while the current dashboard production default targets loopback. That is a runtime target/topology mismatch, not a missing Prometheus server. This source batch does not mutate the production environment or rebind Prometheus. A later exact-SHA Composite Live rollout may set the reviewed dashboard Prometheus target after fresh prewrite revalidation.

## Production boundary

This source work performs no production deployment, evidence-file creation, systemd installation/enable/start/restart, host permission or identity change, Docker authority change, Cloudflare change, backup/update/deploy execution, or terminal activation.

After producer and consumer source are separately reviewed and explicitly merged, one later owner-authorized Composite Live transaction may install/activate the exact reviewed producer artifacts, deploy the exact reviewed dashboard release, set the exact reviewed Prometheus target, and reconcile the read-only acceptance surfaces. Merge authorization never authorizes that live transaction.
