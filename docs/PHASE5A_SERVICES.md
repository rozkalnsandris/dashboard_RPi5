# Phase 5A — Allowlisted systemd services

Issue: #18

This source-only phase adds a bounded native-service read path without activating it on the Raspberry Pi:

```text
Browser
  -> GET /api/services
  -> dashboard server
  -> fixed /v1/services request over the local agent Unix socket
  -> dashboard agent
  -> fixed /usr/bin/systemctl show calls for source-owned unit IDs
```

## Source registry

The initial registry is deliberately small and source-owned:

- `dashboard-rpi5-agent.service` — Dashboard agent
- `docker.service` — Docker Engine
- `ssh.service` — SSH
- `cron.service` — Cron scheduler

Adding or removing a unit requires a reviewed source change. The browser cannot provide a unit name, pattern, command, executable, property list, or socket path.

## systemd read contract

The agent uses `/usr/bin/systemctl` with `shell: false`, a fixed `show` command, a fixed property list, per-call timeout and output limits. `systemctl show` is used because upstream systemd documents it as the computer-parsable interface for unit properties.

The normalized response contains only source-owned labels plus bounded state evidence: load state, active state, sub-state, enablement class, restart count and monotonic state age when available. Unknown future systemd states normalize to `UNKNOWN`; missing evidence is never converted to running/healthy/zero.

## Server boundary

The dashboard server has one purpose-built Unix-socket client for `/v1/services`. It is not a generic agent proxy. Browser query parameters are rejected, agent non-200/malformed/oversized/timeout responses become `SOURCE_UNAVAILABLE`, and upstream response bodies are not forwarded.

## UI boundary

The Services page polls every 10 seconds while visible and does not poll in the background. It exposes explicit healthy/attention/critical/unknown text in addition to color, shows stale/error state, uses cards on phones and a table on desktop, and keeps 320 CSS px reflow support.

## Explicitly not included

- systemd start/stop/restart/enable/disable;
- journal/log reads;
- systemd event subscriptions;
- arbitrary unit lookup;
- agent or systemd activation on the RPi5;
- Docker permission changes;
- Cloudflare changes;
- Quick Commands/PTTY;
- any host/container/production write.

**Production deploy: NO.**
