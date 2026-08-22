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

## 2026-08-22 read-only live diagnosis

The operator ran the exact-head diagnostic against accepted production release `46c47fbd53e6933e2d8db86abdab30edea2badd0`. The run explicitly reported `PRODUCTION_MUTATION=NO` and no systemd, identity/permission, Docker-authority, Cloudflare or terminal mutation.

The evidence narrows #196 as follows:

- **Services is live and fresh:** `/api/services` returned HTTP 200 and the observed age was `0` seconds. No Services source change is justified.
- **Docker Prometheus logs are already live:** the registered Docker Prometheus log route returned HTTP 200. #199 only fixes the production default wiring so Docker sources consistently use the reviewed broker-backed adapter.
- **Prometheus history is a topology/configuration gap:** dashboard history returned HTTP 503 while loopback Prometheus readiness and query probes both returned `000`. The server already defaults to `http://127.0.0.1:9090`; source does not justify fabricating history or blindly changing that client contract.
- **Journal-backed evidence is unavailable at the current identity boundary:** maintenance logs and deployments returned HTTP 503, and `dashboard-rpi5-agent` has neither `systemd-journal` nor `adm`. `PHASE5B_UNIFIED_LOGS.md` explicitly forbids automatically adding broad journal membership just to make a source readable.
- **Backup evidence producer is absent:** `/api/backups` returned HTTP 503 and `/var/lib/dashboard-rpi5/evidence/backups.json` is absent. The existing root-owned `/var/log/rpi5-backup.log` is present but mode `0600`; the authoritative backup runner remains owned by `rozkalnsandris/RPi5_main`.
- **Endpoint evidence producer is absent:** `/api/endpoints` returned HTTP 503 and `/var/lib/dashboard-rpi5/evidence/endpoints.json` is absent. Read-only source inspection confirms `RPi5_main` already owns the authoritative `rpi5-monitor` public probes, so a producer must be integrated at that authority boundary rather than duplicated by the dashboard browser.
- **Docker detailed stats are partially unavailable:** 20 containers were running and 12 reported unavailable stats. The source has bounded per-container broker reads and intentional partial-failure semantics; this evidence does not prove that the 1500 ms broker/Engine timeout is the cause, so #199 must not raise timeouts blindly.
- **Throttle remains an explicit supported-unavailable path:** `vcgencmd` exists, while the agent intentionally lacks `video`. The first diagnostic classified `/dev/vcio` as `NOT_REGULAR` because it reused a regular-file check; that does not prove absence of the character device. The helper is corrected to report device type/ownership/mode metadata without reading the device.

## #199 source slice boundary

PR #199 is intentionally a first restoration slice under #196, not issue closure. It:

- wires Docker log sources through the existing bounded Docker broker adapter;
- removes the Phase 1 Settings fixture from production navigation/routing;
- adds and hardens one reusable read-only host diagnostic;
- records the exact remaining authority/topology gaps without weakening fail-closed behavior.

PR #199 does **not** claim to make Prometheus history, backup evidence, endpoint evidence, journal-backed logs/deployments, partial Docker stats or throttle live in production. Issue #196 stays open until those paths have their own reviewed source/live integration and acceptance evidence.

## Remaining integration boundaries

The next #196 source/live work must preserve these rules:

- do not grant the main agent `docker` or `video` membership;
- do not automatically grant broad `systemd-journal`/`adm` membership; choose the narrowest reviewed evidence path first;
- do not change `RPi5_main` backup/monitor source from this Dashboard task: that repository permits only narrowly scoped read-only inspection unless the owner explicitly opens a source task there;
- do not fabricate backup/endpoint JSON or treat missing evidence as healthy;
- do not change Prometheus URL/topology without exact host evidence identifying the reachable reviewed target;
- do not raise Docker timeouts/concurrency merely because some stats are unavailable;
- any later permission, systemd, Docker topology, production config, restart or deploy remains a separately authorized Composite Live boundary.

Terminal activation remains outside #196 and stays blocked until the read-only dashboard and logs are stable.
