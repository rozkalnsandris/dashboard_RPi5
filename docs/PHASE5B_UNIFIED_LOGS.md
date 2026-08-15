# Phase 5B — Unified registered logs

Phase 5B replaces the fixture Logs page with a bounded, read-only log explorer while preserving the local-agent trust boundary.

## Route boundary

Browser-facing routes:

- `GET /api/logs/sources`
- `GET /api/logs?sourceId=<registered>&range=<15m|1h|6h|24h>`

Agent routes:

- `GET /v1/logs/sources`
- `GET /v1/logs?sourceId=<registered>&range=<15m|1h|6h|24h>`

There is no generic agent, Docker, systemd or filesystem proxy. Extra query fields are rejected.

## Registered source IDs

The registry is source-owned:

| Browser source ID | Backend | Trusted mapping |
|---|---|---|
| `docker:homeassistant` | Docker Engine logs API | container `homeassistant` |
| `docker:prometheus` | Docker Engine logs API | container `prometheus` |
| `systemd:docker` | journal | `docker.service` |
| `systemd:ssh` | journal | `ssh.service` |
| `systemd:cron` | journal | `cron.service` |
| `systemd:dashboard-rpi5-agent` | journal | `dashboard-rpi5-agent.service` |
| `file:rpi5-backup` | bounded file tail | `/var/log/rpi5-backup.log` |

The browser receives descriptor IDs, labels, source kinds and range semantics. It does not receive the mapped file path or command invocation.

## Docker logs

Docker sources use the Docker Engine container logs endpoint over the existing fixed local Engine socket and pinned API prefix. They never read Docker `json-file` backing files directly.

The request shape is server-owned:

- stdout + stderr;
- timestamps enabled;
- server-derived `since` from a fixed range preset;
- fixed `tail=400`;
- no `follow` stream at the Engine boundary in this phase;
- 512 KiB response ceiling and bounded deadline.

Both Docker multiplexed raw-stream framing and plain TTY-style output are normalized. Docker log content is plain untrusted text; the dashboard does not infer severity from arbitrary message text.

## Journal logs

Systemd sources use fixed `/usr/bin/journalctl` with a reviewed unit registration. The fixed invocation uses:

- no pager;
- JSON output;
- selected structured fields;
- one registered `--unit=` value;
- one fixed `--since=` preset;
- maximum 400 lines;
- bounded output and deadline;
- no shell.

Journal priority is normalized to the dashboard level vocabulary. Unknown/missing priority stays `UNKNOWN`.

## Registered file logs

The only initial file source maps `file:rpi5-backup` to `/var/log/rpi5-backup.log` in source code. The browser cannot provide or alter a path.

The agent reads only the bounded tail of that exact file:

- maximum 256 KiB read window;
- maximum 400 normalized entries;
- first partial line is discarded when the byte window starts mid-file;
- no file mutation, rotation or deletion.

A generic file does not guarantee trustworthy per-line timestamps. A strict leading UTC ISO timestamp may be recognized; otherwise `timestamp=null`. Because untimestamped file lines cannot be honestly filtered by a requested time range, file snapshots report `rangeApplied=false`. The UI explicitly labels this as tail-only evidence.

## Browser behavior

The Logs page provides:

- registered source selection;
- `15m`, `1h`, `6h`, `24h` range presets;
- 2-second visible-only refresh while Live is enabled;
- Pause to freeze the current validated snapshot;
- client-side search within the bounded snapshot;
- wrap/no-wrap;
- copy of visible normalized lines;
- jump to newest;
- no forced follow after the operator scrolls away from the bottom;
- a bounded new-lines indicator;
- explicit unavailable/degraded/empty/truncated/tail-only states.

Each snapshot is capped at 400 entries, so the page never grows an unbounded log DOM. Messages are rendered as normal React text. There is no `innerHTML` path.

## Activation remains separately gated

Merging Phase 5B source does **not** authorize production activation.

Before live activation on the Raspberry Pi, verify the actual service identity can read each required source using least privilege. Any of the following remains a separate explicit owner gate:

- Docker socket group/ACL/trust expansion;
- journal group/ACL expansion;
- backup-log file permission/ACL expansion;
- installation/enabling/restarting of the dashboard agent or server;
- any systemd unit mutation;
- Cloudflare/DNS/Tunnel/Access changes.

Do not add broad `docker`, `adm`, `systemd-journal`, sudo or root access automatically merely to make a source readable. If the current service identity cannot read a source, activation must stop and request authorization for the narrowest necessary change.

## Failure semantics

Malformed, oversized, timed-out, missing or permission-denied source evidence becomes `SOURCE_UNAVAILABLE`. The UI must not turn a missing source into an empty successful log stream.

No logs are persisted by the dashboard in this phase. Browser/server caching of operational log payloads is not introduced.

**Production deploy: NO.**
