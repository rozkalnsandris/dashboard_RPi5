# Terminal and Logs Security Contract

This document describes the current trust boundaries. Historical phase documents remain evidence of how the design evolved; they do not override the current broker/terminal-agent boundaries.

## Logs

### Browser contract

The browser supplies a stable registered `sourceId` and a fixed range preset, never a raw filesystem path, Docker Engine path, unit name, journal match, container socket target, executable or shell expression.

Examples:

```text
docker:homeassistant
systemd:cloudflared
systemd:dashboard-rpi5-agent
journal:rpi5-deploy
file:rpi5-backup
```

The server maps IDs to fixed reviewed sources.

### Docker log trust path

```text
registered Docker sourceId
  -> web/API
  -> main agent
  -> typed bounded Docker broker log capability
  -> fixed Docker Engine logs GET
```

Only the dedicated Docker broker owns Docker Engine socket authority. The main agent has no persistent `docker` or `video` group membership, does not accept caller-supplied Engine paths/filters/socket targets, and does not expose a generic Docker proxy.

### Host log trust path

```text
registered systemd/journal/file sourceId + fixed range
  -> web/API
  -> main agent
  -> typed bounded dashboard-rpi5-log-broker capability
  -> fixed journalctl unit/origin OR fixed backup-log tail
```

The main agent must not gain `adm`, `systemd-journal`, sudo or root authority to make logs readable. The dedicated host-log broker is intentionally isolated from Docker Engine and terminal/PTTY authority. Its Unix API is GET-only, source/range allowlisted, concurrency/output/time bounded, and exposes no generic path, unit, journal selector, command execution or mutation capability. Root-owned backup-log access is limited in application code to the single registered `/var/log/rpi5-backup.log` path.

For `file:rpi5-backup`, the privileged broker opens that fixed path read-only with final-component no-symlink semantics, validates the opened descriptor as an exact `root:root 0600` regular file, computes the bounded tail offset from descriptor metadata, and reads the tail from the same descriptor. It does not `stat(path)` and later reopen the pathname. A final-component symlink, special filesystem object, unsafe ownership/mode, short read caused by concurrent truncation, open/read error or abort fails closed as `SOURCE_UNAVAILABLE`; the broker never chmods/chowns the source and never accepts a browser-supplied path.

Linux `O_NOFOLLOW` protects the final path component. The reviewed production design therefore retains the existing trusted-system-path assumption for the parent chain `/var/log`; #239 does not add an `openat2` helper or broaden filesystem authority. If that parent-chain assumption changes, a separately reviewed descriptor-walk/`openat2` design is required rather than silently weakening the check.

The source-only broker/systemd blueprint does not itself activate this trust boundary in production. Installing identities/groups/units, enabling/restarting services or changing production permissions remains a separate explicit owner authorization.

### Implementation rules

- broker-only Docker Engine authority;
- separate narrow host-log broker for journal/root-file authority;
- fixed registered source IDs and exact backend mappings;
- fixed file logs use one no-symlink opened descriptor for metadata validation and bounded reading;
- production backup-log metadata is exact `root:root 0600`; metadata drift fails closed without repair;
- bounded line count / bytes / duration / concurrency;
- structured journal output rather than ANSI terminal parsing;
- escape output and never render log content through `innerHTML`;
- redaction may be defense-in-depth but is not the primary secret boundary;
- unknown, malformed or unavailable sources fail closed as `SOURCE_UNAVAILABLE`.

### UI

- grouped registered source picker (`Docker`, `Systemd`, `Journal`, `Files`);
- range selector;
- search;
- live follow;
- pause;
- wrap/no-wrap;
- copy visible lines;
- jump to newest;
- bounded DOM rendering.

## Quick Commands

Quick Commands are the production-active terminal-like diagnostic surface. They are deliberately narrower than Docker CLI or free-form shell.

The accepted production catalog is exactly:

```text
host.disk-root
host.failed-units
host.kernel
host.uptime
```

Browser example:

```json
{ "commandId": "host.uptime" }
```

The server/agent maps each ID to a fixed executable and fixed argument array with bounded timeout/output. Browser input never supplies an executable, shell string, Docker target, socket path, or arbitrary argv.

Rules:

- fixed registered IDs;
- `execFile`/`spawn` style argument arrays;
- no string concatenation;
- no normal `sh -c` path;
- no Docker CLI or Docker socket authority;
- no terminal/PTTY authority;
- bounded timeout/output;
- owner-only execution gate;
- audit command ID, time, result and duration.

## Full terminal

Full PTY source is intentionally isolated from the privileged-read main agent.

Current conceptual path:

```text
browser
  -> authenticated same-origin web/API terminal gate
  -> bounded WebSocket/session protocol
  -> local terminal Unix transport
  -> dashboard-rpi5-terminal-agent
  -> contained normal-user PTY
```

The separate terminal agent is the PTY boundary. It must not inherit Docker broker authority, main-agent privileged-read authority, root, or automatic sudo.

Required controls remain:

- owner revalidation before terminal admission/upgrade;
- strict Origin/subprotocol/session claim checks;
- normal non-root terminal identity;
- no supplementary privileged groups;
- no automatic sudo;
- fixed shell/environment;
- idle timeout and maximum lifetime;
- low concurrency;
- kill PTY on disconnect/expiry;
- bounded protocol frames/output;
- no third-party runtime scripts on the terminal page;
- session-metadata audit rather than default keystroke/output persistence.

## Production state

Source presence is not activation evidence. Any host-log broker activation, terminal activation, host permission change, systemd activation, or other trust-boundary mutation requires a separate explicit owner authorization.

## Why the terminal is isolated

Browser terminals raise the security requirements of the whole scripting context. Keeping PTY execution in a separate contained normal-user terminal agent prevents free-form shell capability from inheriting Docker Engine authority or host-log evidence privileges.
