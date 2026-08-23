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

The full source-owned registry keeps the reviewed parsers and trusted mappings:

| Browser source ID | Backend | Trusted mapping |
|---|---|---|
| `docker:homeassistant` | Docker Engine logs API | container `homeassistant` |
| `docker:prometheus` | Docker Engine logs API | container `prometheus` |
| `systemd:docker` | journal | `docker.service` |
| `systemd:ssh` | journal | `ssh.service` |
| `systemd:cron` | journal | `cron.service` |
| `systemd:dashboard-rpi5-agent` | journal | `dashboard-rpi5-agent.service` |
| `systemd:rpi5-update` | journal | `rpi5-update.service` |
| `journal:rpi5-deploy` | journal | fixed root/syslog origin |
| `file:rpi5-backup` | bounded file tail | `/var/log/rpi5-backup.log` |

The browser receives descriptor IDs, labels, source kinds and range semantics. It does not receive mapped file paths or command invocation.

### Production-advertised subset

The source registry and the production-advertised source list are intentionally distinct.

Issue #196 live evidence proved the production `dashboard-rpi5-agent` identity has no broad journal-read authority and cannot read the root-only `0600` backup log. Those are security invariants, not reasons to grant `adm`, `systemd-journal` or relaxed backup-log permissions.

Therefore `/v1/logs/sources` and the browser-facing `/api/logs/sources` advertise only sources backed by the current reviewed least-privilege production authority:

- `docker:homeassistant`
- `docker:prometheus`

Both are read through the dedicated bounded Docker broker capability. Journal and root-only file registrations remain source-owned and fail closed when directly requested, but they are not presented as selectable live sources while they are guaranteed to be unavailable under the current service identity.

Re-advertising a dormant journal or root-only file source requires a separately reviewed narrow backend/trust-boundary decision. It must not be achieved by silently adding `docker`, `adm`, `systemd-journal`, `video`, sudo or root authority to the main agent.

## Docker logs

Docker sources use the Docker Engine container logs endpoint through the existing fixed local broker capability. They never read Docker `json-file` backing files directly.

The request shape is server-owned:

- stdout + stderr;
- timestamps enabled;
- server-derived `since` from a fixed range preset;
- fixed `tail=400`;
- no `follow` stream at the Engine boundary in this phase;
- 512 KiB response ceiling and bounded deadline.

Both Docker multiplexed raw-stream framing and plain TTY-style output are normalized. Docker log content is plain untrusted text; the dashboard does not infer severity from arbitrary message text.

## Journal logs

Dormant systemd registrations use fixed `/usr/bin/journalctl` with a reviewed unit registration when exercised in tests or a future separately authorized narrow runtime design. The fixed invocation uses:

- no pager;
- JSON output;
- selected structured fields;
- one registered `--unit=` value;
- one fixed `--since=` preset;
- maximum 400 lines;
- bounded output and deadline;
- no shell.

Journal priority is normalized to the dashboard level vocabulary. Unknown/missing priority stays `UNKNOWN`.

These registrations are not production-advertised under the current least-privilege agent identity.

## Registered file logs

The reviewed file registration maps `file:rpi5-backup` to `/var/log/rpi5-backup.log` in source code. The browser cannot provide or alter a path.

The parser reads only the bounded tail of that exact file:

- maximum 256 KiB read window;
- maximum 400 normalized entries;
- first partial line is discarded when the byte window starts mid-file;
- no file mutation, rotation or deletion.

A generic file does not guarantee trustworthy per-line timestamps. A strict leading UTC ISO timestamp may be recognized; otherwise `timestamp=null`. Because untimestamped file lines cannot be honestly filtered by a requested time range, file snapshots report `rangeApplied=false`. The UI explicitly labels this as tail-only evidence.

The production backup log remains root-owned `0600`; this source is therefore dormant and not production-advertised.

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

Before live activation on the Raspberry Pi, verify the actual service identity can read each advertised source using least privilege. Any of the following remains a separate explicit owner gate:

- Docker socket group/ACL/trust expansion;
- journal group/ACL expansion;
- backup-log file permission/ACL expansion;
- installation/enabling/restarting of the dashboard agent or server;
- any systemd unit mutation;
- Cloudflare/DNS/Tunnel/Access changes.

Do not add broad `docker`, `adm`, `systemd-journal`, sudo or root access automatically merely to make a source readable. If the current service identity cannot read a source, keep it unadvertised/fail-closed until a separately reviewed narrow capability exists.

## Failure semantics

Malformed, oversized, timed-out, missing or permission-denied source evidence becomes `SOURCE_UNAVAILABLE`. The UI must not turn a missing source into an empty successful log stream.

No logs are persisted by the dashboard in this phase. Browser/server caching of operational log payloads is not introduced.

**Production deploy: YES for the issue #196 production-advertisement correction after merge; activation remains separately owner-gated.**
