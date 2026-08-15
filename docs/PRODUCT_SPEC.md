# Product Specification

## Identity

- **GitHub repository:** `rozkalnsandris/dashboard_RPi5`
- **Product name:** `dashboard_RPi5`
- **Public hostname:** `dash.rozkalns.net`
- **Primary device:** Raspberry Pi 5
- **Primary user:** owner/admin
- **Mode:** desktop + mobile web application

## Problem

The Pi already has specialist tools for metrics, availability and containers, but daily diagnosis is fragmented across several interfaces and SSH. The product consolidates the most important evidence and the shortest safe path to investigation.

## Success questions

The Overview is successful if the user can answer these in roughly five seconds:

- Is the Pi healthy?
- Is it too hot, under-voltage or throttling?
- Is CPU/RAM/NVMe usage normal?
- Are expected Docker containers running and healthy?
- Which container is currently the biggest CPU/RAM/network/disk-I/O consumer?
- Did anything restart recently?
- Did the last backup succeed and is it fresh?
- Are important public endpoints reachable?
- Is production behind GitHub `main`?
- Is there anything that needs attention right now?

## Primary pages

### Overview

Health-first summary. One desktop viewport should show the high-value state without becoming a wall of charts.

Top cards:

- system health;
- uptime;
- CPU temperature;
- RPi throttling/under-voltage state;
- CPU load;
- RAM;
- root/NVMe filesystem.

Main content:

- Needs Attention;
- Docker summary;
- Top Consumers;
- Recent Activity;
- Public Endpoints;
- Backup status;
- update/maintenance evidence.

### Docker

Desktop table, mobile compact rows.

Fields:

- name;
- state/health;
- CPU %;
- RAM used/limit/%;
- network RX/TX;
- block read/write;
- PIDs;
- uptime;
- restart count;
- image/version.

Container details:

- current status;
- ports;
- safe mount summary;
- 1h / 24h / 7d trends;
- recent Docker events;
- recent logs;
- links to Grafana/Portainer where useful.

### Services

Allowlisted systemd/native services only. Show active/sub-state, age, last failure and journal drill-down.

### Logs

Unified explorer for allowlisted sources:

```text
docker:<container-id>
systemd:<unit-id>
file:<registered-log-id>
```

The browser never supplies a filesystem path.

Features:

- source picker;
- time range;
- search;
- severity filter where structured data exists;
- live follow;
- pause;
- wrap/no-wrap;
- copy selected lines;
- new-lines indicator when paused.

### Terminal

Two-stage product:

1. **Quick Commands** — safe registered diagnostics, optimized for phone.
2. **Full Terminal** — owner-only xterm.js + PTY in a later hardened phase.

### Activity

Human-readable timeline combining Docker events, service changes, backups, deploy evidence and endpoint changes.

### Backups

Last result, age, duration, size, retention and recent history.

### Deployments

For every production-relevant project:

```text
project | production SHA | main SHA | drift/classification | last deploy | health
```

Merge authorization is not deploy authorization.

## Deliberately out of scope

- Grafana replacement;
- Prometheus replacement;
- full Portainer replacement;
- arbitrary remote filesystem browser;
- public Docker socket/API;
- root web shell;
- generic `systemctl` pass-through;
- generic `docker exec` pass-through;
- novelty widgets that do not help operations.
