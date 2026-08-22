# Issue #196 — live read-only evidence restoration

## Purpose

Issue #196 restores already-designed read-only dashboard surfaces that are visibly unavailable or stale on `dash.rozkalns.net` before any full-terminal activation.

The work is evidence-driven. Missing evidence must remain unavailable/unknown until its real source chain is restored; fixture values or fabricated healthy zeros are forbidden.

## Source audit findings before host diagnosis

The current source already proves several important distinctions:

1. **Backup evidence is consumer-only today.** `docs/PHASE6A_BACKUPS.md` explicitly says Phase 6A does not create `/var/lib/dashboard-rpi5/evidence/backups.json` or the live producer. A missing file in production is therefore an integration gap, not a UI parsing bug.
2. **Endpoint evidence is consumer-only today.** `docs/PHASE6B_PUBLIC_ENDPOINTS.md` explicitly defers the producer for `/var/lib/dashboard-rpi5/evidence/endpoints.json`.
3. **Docker logs have a bounded broker adapter in source.** `apps/agent/src/docker-logs-live.ts` exists because the main agent no longer owns Docker Engine authority. The production wiring must be verified against that adapter rather than restoring direct Docker socket access.
4. **Journal-backed logs and deployment evidence need a real readable journal path.** The main agent intentionally has narrow supplementary groups; host evidence must determine whether the current identity can read the reviewed journal sources without widening authority.
5. **Throttle evidence is intentionally fail-closed.** `vcgencmd get_throttled` failure becomes `UNAVAILABLE`; host evidence must distinguish a missing binary/device/permission boundary from malformed output. The main agent must not regain broad `video` authority merely to make the card green.
6. **Prometheus history already defaults to loopback `127.0.0.1:9090`.** Missing `DASHBOARD_PROMETHEUS_URL` alone is not a sufficient root-cause claim. The local Prometheus readiness, query result and dashboard normalization path must be checked.
7. **Settings is still a Phase 1 reliability-state fixture route.** That is a source-level production UX mismatch and will be removed or replaced inside #196 rather than presented as a working setting surface.

## Read-only host diagnostic

`tools/operator/issue196-live-evidence-diagnostic.sh` is a no-argument, read-only evidence collector. It:

- probes only fixed loopback dashboard and Prometheus URLs with GET requests;
- reports HTTP status for host, Docker, services, history, logs, backups, endpoints and deployments;
- reports Prometheus readiness and whether `node_load1` has any returned series;
- reports service snapshot age and the count of running containers whose Docker stats are unavailable;
- reports metadata-only presence of the fixed backup/endpoint evidence files, backup log, web env and `/dev/vcio`;
- reports whether the agent identity has `video` or broad journal-read group membership;
- never prints evidence-file contents, environment-file contents, credentials or tokens;
- performs no `sudo`, service restart, systemd mutation, permission/group change, Docker mutation, Cloudflare mutation or terminal activation.

The output is diagnostic evidence only. A PASS-like HTTP result is not authorization to mutate production.

## Repair strategy after the diagnostic

Use one #196 PR and keep repairs clustered by the actual root cause:

- source wiring/parser defects are corrected in source;
- missing producers are implemented at their authoritative source rather than by fabricating dashboard data;
- any required production config, service or permission reconciliation is prepared as a later exact-main Composite Live envelope;
- broad privilege expansion is rejected when a narrower typed/read-only path can satisfy the evidence contract.

Terminal activation remains outside #196 and stays blocked until the read-only dashboard and logs are stable.
