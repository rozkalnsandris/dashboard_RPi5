# Phase 5B — Unified registered logs

Phase 5B provides a bounded, read-only log explorer while preserving explicit local trust boundaries.

## Route boundary

Browser-facing routes:

- `GET /api/logs/sources`
- `GET /api/logs?sourceId=<registered>&range=<15m|1h|6h|24h>`

Agent routes:

- `GET /v1/logs/sources`
- `GET /v1/logs?sourceId=<registered>&range=<15m|1h|6h|24h>`

There is no generic agent, Docker, systemd, journal or filesystem proxy. Extra query fields are rejected.

## Production source catalog

The reviewed source catalog is fixed in source code. The browser receives only descriptor IDs, labels, kinds and range semantics; it never receives or supplies mapped paths, unit names, journal matches or Docker Engine selectors.

| Browser source ID | Backend | Trusted mapping |
|---|---|---|
| `docker:homeassistant` | Docker broker | container `homeassistant` |
| `docker:prometheus` | Docker broker | container `prometheus` |
| `systemd:docker` | log broker / journal | `docker.service` |
| `systemd:ssh` | log broker / journal | `ssh.service` |
| `systemd:cron` | log broker / journal | `cron.service` |
| `systemd:dashboard-rpi5-agent` | log broker / journal | `dashboard-rpi5-agent.service` |
| `systemd:rpi5-update` | log broker / journal | `rpi5-update.service` |
| `systemd:cloudflared` | log broker / journal | `cloudflared.service` |
| `systemd:rpi5-monitor` | log broker / journal | `rpi5-monitor.service` |
| `systemd:rpi5-post-reboot` | log broker / journal | `rpi5-post-reboot.service` |
| `systemd:rpi5-tmp-headroom` | log broker / journal | `rpi5-tmp-headroom.service` |
| `systemd:rpi5-dashboard-evidence` | log broker / journal | `rpi5-dashboard-evidence.service` |
| `systemd:hermes-tech-web` | log broker / journal | `hermes-tech-web.service` |
| `journal:rpi5-deploy` | log broker / journal | fixed root/syslog `rpi5-deploy` origin |
| `file:rpi5-backup` | log broker / bounded file tail | `/var/log/rpi5-backup.log` |

No discovered container, unit, journal match or filesystem path is accepted dynamically.

## Trust paths

Docker logs retain the existing isolated authority:

```text
registered Docker sourceId
  -> web/API
  -> main agent
  -> bounded Docker broker
  -> fixed Docker Engine logs GET
```

Systemd, journal and the registered backup file use a separate source-only bounded capability:

```text
registered host-log sourceId + fixed range
  -> web/API
  -> main agent
  -> dashboard-rpi5-log-broker Unix socket
  -> fixed journalctl unit/origin OR fixed backup-log tail
```

The main `dashboard-rpi5-agent` remains non-root and must not join `docker`, `adm` or `systemd-journal`. The log broker has no mutation route, no generic command/path/unit/journal selector, no network authority, and is intended only for the reviewed journal records plus the one root-owned backup log.

## Bounds and failure semantics

The existing parser bounds remain authoritative:

- maximum 400 normalized entries;
- maximum 8,192 characters per normalized message;
- maximum 512 KiB source evidence;
- bounded journal command deadline;
- maximum 256 KiB registered file tail;
- fixed `15m`, `1h`, `6h`, `24h` time presets;
- no shell invocation;
- malformed, oversized, timed-out, missing or permission-denied evidence becomes `SOURCE_UNAVAILABLE`.

The log broker adds its own bounded Unix API envelope: fixed GET-only routes, low concurrency, bounded response bytes and a hard request deadline. Docker Engine authority remains exclusively in the Docker broker.

File evidence stays tail-only because arbitrary file lines do not provide trustworthy timestamps; `rangeApplied=false` is preserved for `file:rpi5-backup`.

## Startup readiness and socket permissions

The production log-broker unit uses `UMask=0117`, so its pathname AF_UNIX socket is created at no broader than the final `0660` client mode (`0777 & ~0117 = 0660`). The broker still applies an explicit post-listen `chmod(0660)` as defense in depth.

The unit remains `Type=exec`, so systemd `active` state alone is not application readiness. Live acceptance must use bounded polling and require the service to remain active, the socket to exist with exact `root:dashboard-rpi5-log-client:0660` ownership/mode, `/v1/health` to return the expected healthy broker identity, and the broker PID/restart counter to remain stable across the acceptance window.

## Browser behavior

The Logs page groups selectable sources as `Docker`, `Systemd`, `Journal` and `Files` while preserving:

- registered source selection only;
- `15m`, `1h`, `6h`, `24h` range presets;
- 2-second visible-only refresh while Live is enabled;
- Pause to freeze the current validated snapshot;
- client-side search within the bounded snapshot;
- wrap/no-wrap;
- copy of visible normalized lines;
- jump to newest;
- no forced follow after the operator scrolls away from the bottom;
- bounded new-lines indicator;
- explicit unavailable/degraded/empty/truncated/tail-only states.

Each snapshot remains capped at 400 entries and messages are rendered as React text; there is no `innerHTML` path.

## Activation remains separately gated

Issue #223 source introduces a `dashboard-rpi5-log-broker` blueprint and a dedicated `dashboard-rpi5-log-client` relationship. Merging this source does **not** install, create, enable, start or restart either service and does not change production groups or permissions.

Live activation must be separately owner-authorized and must verify the exact deployed SHA, exact service identities/groups/socket ownership, fixed journal/file readability, broker bounds, main-agent non-membership in `adm`/`systemd-journal`/`docker`, and all existing dashboard health checks. Cloudflare changes are not part of this capability.

Until that production gate is executed, the already deployed release remains the production authority; source presence alone is not live evidence.

**Production deploy: expected YES after merge, with log-broker activation separately owner-gated.**
