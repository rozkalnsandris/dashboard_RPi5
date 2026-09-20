# dashboard_RPi5 Roadmap

> **Canonical durable product contract:** GitHub issue [#1 — MASTER / READ FIRST](https://github.com/rozkalnsandris/dashboard_RPi5/issues/1).  
> **Mutable continuation/runtime handoff:** GitHub issue #213.

This file is the repository index for the delivery plan. Issue #1 is authoritative for durable product/security scope. Mutable source/PR/CI/runtime state must be freshly read from GitHub and trusted-host evidence rather than copied into this file.

## Mandatory workflow

```text
issue -> fresh main -> fresh branch -> focused change -> Draft PR
      -> exact-head CI -> exact diff/manual review -> Ready -> STOP
      -> explicit owner squash merge -> exact-main verify
      -> Production deploy: YES / NO
```

No merge without explicit owner authorization. Merge authorization is not deployment authorization.

Separate explicit owner authorization is required for production deployment, Cloudflare mutation, host/root mutation, Docker trust-boundary expansion, systemd activation, Quick Command activation, full PTY activation and production write controls.

## Frontend architecture guardrail

ADR-0007 defines the durable UI implementation direction:

```text
React + TypeScript + Vite
  -> semantic HTML first
  -> browser-native controls/primitives first
  -> plain product CSS + CSS custom properties
  -> CSS cascade layers
  -> extra UI library only when behavior/accessibility justifies it
```

React Router, TanStack Query and Lucide remain. React Aria is exception-only for complex accessible interactions. Tailwind and shadcn/ui are not architectural requirements for future work; Tailwind source removal requires a separate exact usage/Preflight and regression audit.

Do not turn dependency simplification into a React rewrite or into trust-boundary flattening.

## Phases

### Phase 0 — Governance + design baseline

Repository rules, security contract, architecture, A55/mobile spec, HTML/CSS guidance, data-source contract, terminal/log contract, research, ADRs and mockups.

**Production deploy: NO.**

### Phase 1 — Frontend foundation / fixture UI

React + TypeScript + Vite shell with semantic HTML, source-owned product CSS, Overview, Docker, Services, Logs, Terminal/Quick Commands, Activity, Backups and Deployments. Desktop sidebar plus Samsung A55 bottom navigation. PWA shell baseline and accessibility regression tests.

No RPi connection.

### Phase 2A — Local agent skeleton

Narrow local agent boundary over a Unix socket with health/version protocol, bounded errors/timeouts and allowlist framework. No Docker socket and no shell yet. Source-only systemd unit until separately authorized.

### Phase 2B — Host read-only health

Uptime, CPU/load, RAM/swap, root filesystem, Pi temperature, decoded throttle/under-voltage evidence, observed timestamps and stale semantics. First live RPi activation requires separate owner authorization.

### Phase 3A — Docker current-state read boundary

Container inventory, health/state, CPU, memory, network, block I/O, PIDs, uptime and restart count through the dedicated bounded Docker authority. No generic Engine proxy, exec, restart, stop or remove.

### Phase 3B — Docker events

Bounded read-only Docker container event projection for health/start/stop/restart/OOM/die/update-style operational evidence. Event filters/window semantics remain server-owned and bounded.

### Phase 4 — Bounded native operational history + Grafana drill-down

Provide predefined `1h` / `24h` / `7d` operational history, Top Consumers and compact sparklines using server-owned bounded queries. Prometheus remains the time-series authority and no duplicate metrics database is introduced.

Grafana remains a specialist/deep-analysis option. The dashboard is not a general visualization/query platform and there is no current roadmap commitment to retire Grafana. A future retirement decision would require a separate product/operations contract change and separately authorized LIVE decommissioning.

For per-container history, preserve ADR-0005/ADR-0006: the dedicated Docker broker remains the sole Docker Engine socket authority; historical collection must not give an exporter direct Docker socket/group/generic Engine access.

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

Authoritative GitHub `main` versus proven production SHA with explicit unknown/stale semantics. No deployment write action in this phase.

### Phase 7 — PWA + Samsung A55 production polish

Installable PWA, safe static caching, offline/stale state, Samsung Browser + Chrome, portrait + landscape, keyboard-open testing, increased font/display scaling and real-device acceptance. Never persistently cache logs, terminal, auth/session or sensitive API data.

### Phase 8 — Quick Commands

Owner-only registered diagnostics using fixed executable + fixed/typed argument arrays with timeout/output/concurrency limits and audit evidence. No browser-supplied executable, arbitrary flags or generic `sh -c`. Production activation requires separate owner authorization.

### Phase 9 — Full terminal beta

xterm.js + PTY over secure WebSocket after dedicated security review. Owner-only, non-root default, no auto-sudo, origin validation, idle/max lifetime, low concurrency and mobile accessibility/keyboard acceptance. Production activation requires separate owner authorization.

### Phase 10 — Controlled write actions

Only after another explicit product/security decision. Potential bounded restart/maintenance/deployment actions with state revalidation, confirmation, audit and recovery evidence. Never add a generic root, Docker, `systemctl`, `docker exec` or prune endpoint.

### Phase 11 — Production launch at `dash.rozkalns.net`

Operational launch with exact-main evidence, Access, Tunnel, systemd deployment, smoke tests and recorded production SHA. Every production mutation is separately owner-authorized.

### Phase 12 — Ongoing operations / hardening

Dependency review, frontend simplification, CSP, Cloudflare policy, systemd sandboxing, agent permissions, Docker access, PWA caching, audit retention and performance monitoring.

Frontend hardening should reduce accidental abstraction/dependency surface without rewriting stable application architecture. Candidate work includes a focused Tailwind removal after usage/Preflight audit, incremental CSS-layer organization and React Aria inventory.

The dashboard itself must remain lightweight enough not to become a meaningful RPi workload.

## Definition of success

The project is successful when the A55 provides a fast daily health/diagnostic view, desktop offers denser operations visibility, Prometheus and specialist tools remain authoritative where appropriate, routine logs/diagnostics no longer require SSH, terminal/write controls stay explicitly gated, missing evidence is never shown as healthy, the dashboard itself stays lightweight, and every trust-boundary expansion is explainable from GitHub history.
