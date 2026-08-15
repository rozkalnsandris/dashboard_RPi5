# dashboard_RPi5 Roadmap

> **Canonical live roadmap:** GitHub issue [#1 — MASTER / READ FIRST](https://github.com/rozkalnsandris/dashboard_RPi5/issues/1).

This file is the repository index for the delivery plan. Issue #1 is authoritative for current phase, owner gates, security invariants and detailed exit criteria.

## Mandatory workflow

```text
issue -> fresh main -> fresh branch -> focused change -> Draft PR
      -> exact-head CI -> exact diff/manual review -> Ready -> STOP
      -> explicit owner squash merge -> exact-main verify
      -> Production deploy: YES / NO
```

No merge without explicit owner authorization.

**Merge authorization is not deployment authorization.**

Separate explicit owner authorization is required for production deployment, Cloudflare mutation, host/root mutation, Docker trust-boundary expansion, systemd activation, Quick Command activation, full PTY activation and production write controls.

## Phases

### Phase 0 — Governance + design baseline

Repository rules, security contract, architecture, A55/mobile spec, HTML/CSS guidance, data-source contract, terminal/log contract, research, ADRs and mockups.

**Production deploy: NO.**

### Phase 1 — Frontend foundation / fixture UI

React + TypeScript + Vite shell; Overview, Docker, Services, Logs, Terminal/Quick Commands, Activity, Backups and Deployments using deterministic fixture data. Desktop sidebar plus Samsung A55 bottom navigation. PWA shell baseline and accessibility regression tests.

No RPi connection.

### Phase 2A — Local agent skeleton

Create the narrow local agent boundary over a Unix socket with health/version protocol, bounded errors/timeouts and allowlist framework.

No Docker socket and no shell yet. Source-only systemd unit until separately authorized.

### Phase 2B — Host read-only health

Uptime, CPU/load, RAM/swap, root filesystem, Pi temperature, decoded throttle/under-voltage evidence, observed timestamps and stale semantics.

First live RPi activation requires separate owner authorization.

### Phase 3 — Docker read-only integration

Container inventory, health/state, CPU, memory, network, block I/O, PIDs, uptime, restart count and Docker events through the local agent.

No generic Engine proxy, exec, restart, stop or remove.

Docker socket permission expansion is a separate owner gate.

### Phase 4 — Prometheus history + Grafana bridge

1h/24h/7d history, top consumers, compact sparklines and deep links to Grafana. Prometheus remains the time-series authority; no duplicate metrics database.

### Phase 5A — Services read-only

Allowlisted systemd/native service state and detail evidence. No arbitrary unit names and no service mutation.

### Phase 5B — Unified logs

Registered `sourceId` model for Docker logs, journal logs and explicitly registered files. Search, ranges, live follow, pause, wrap, copy and bounded rendering. Raw paths are rejected.

### Phase 5C — Activity timeline

Normalize Docker events, service changes, backup results, endpoint changes, deployment evidence and maintenance events into a human-readable timeline.

### Phase 6A — Backups

Last run, freshness, result, duration, size, retention, history and next expected run where known. Successful-but-stale is not healthy.

### Phase 6B — Public endpoints

High-value endpoint availability projection with optional deep links to Uptime Kuma. Do not duplicate every monitor.

### Phase 6C — Deployment state

Authoritative GitHub `main` versus proven production SHA with states such as `IN_SYNC`, `MAIN_AHEAD_NO_DEPLOY`, `DEPLOY_REQUIRED`, `DEPLOY_PENDING_AUTH`, `UNKNOWN`.

No deployment write action in this phase.

### Phase 7 — PWA + Samsung A55 production polish

Installable PWA, safe static caching, offline/stale state, Samsung Browser + Chrome, portrait + landscape, keyboard-open testing, increased font/display scaling and real-device acceptance.

Never persistently cache logs, terminal, auth/session or sensitive API data.

### Phase 8 — Quick Commands

Owner-only registered diagnostics using fixed executable + fixed/typed argument arrays with timeout/output limits and audit evidence.

No browser-supplied executable, arbitrary flags or generic `sh -c`.

Production activation requires separate owner authorization.

### Phase 9 — Full terminal beta

xterm.js + PTY over secure WebSocket after a dedicated security review. Owner-only, non-root default, no auto-sudo, origin validation, idle/max lifetime, low concurrency and mobile accessory keys.

Production activation requires separate owner authorization.

### Phase 10 — Controlled write actions

Only after another explicit product/security decision. Potentially bounded restart/maintenance/deployment actions with state revalidation, confirmation, audit and recovery evidence.

Never add a generic root, Docker, `systemctl`, `docker exec` or prune endpoint.

### Phase 11 — Production launch at `dash.rozkalns.net`

Operational launch with exact-main evidence, Access, Tunnel, systemd deployment, smoke tests and recorded production SHA. Every production mutation in this phase is separately owner-authorized.

### Phase 12 — Ongoing operations / hardening

Dependency review, CSP, Cloudflare policy, systemd sandboxing, agent permissions, Docker access, PWA caching, audit retention and performance monitoring.

The dashboard itself must remain lightweight enough not to become a meaningful RPi workload.

## Initial implementation issue order

After the Phase 0 baseline is merged, open only the next bounded work items:

```text
Phase 1 toolchain/CI foundation
Phase 1 desktop + A55 shell
Phase 1 Overview fixtures
Phase 1 Docker/Logs/Terminal fixture pages
Phase 1 accessibility + A55/PWA acceptance
Phase 2A local agent protocol + Unix socket
Phase 2B host health read adapter
Phase 3 Docker read boundary
...
```

Do not create dozens of speculative issues before earlier phases provide enough evidence to define them correctly.

## Definition of success

The project is successful when the A55 provides a fast daily health/diagnostic view, desktop offers denser operations visibility, specialist tools remain authoritative for deep analysis, routine logs/diagnostics no longer require SSH, terminal/write controls stay explicitly gated, missing evidence is never shown as healthy, and every trust-boundary expansion is explainable from GitHub history.
