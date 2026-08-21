# Terminal and Logs Security Contract

This document describes the current trust boundaries. Historical phase documents remain evidence of how the design evolved; they do not override the current broker/terminal-agent boundaries.

## Logs

### Browser contract

The browser supplies a stable `sourceId`, never a raw filesystem path, Docker Engine path, container socket target, or shell expression.

Examples:

```text
docker:homeassistant
docker:prometheus
systemd:cloudflared
systemd:dashboard-rpi5-agent
file:rpi5-backup
```

The server maps these IDs to registered/allowlisted sources.

### Current Docker log trust path

```text
registered sourceId
  -> web/API
  -> main agent
  -> typed bounded Docker broker log capability
  -> fixed Docker Engine logs GET
```

Only the dedicated Docker broker owns Docker Engine socket authority. The main agent has no persistent `docker` or `video` group membership, does not accept caller-supplied Engine paths/filters/socket targets, and does not expose a generic Docker proxy.

Journal and registered file logs remain purpose-built reads through the main-agent boundary where applicable.

### Implementation rules

- broker-only Docker Engine authority;
- fixed registered source IDs;
- bounded line count / bytes / duration;
- prefer structured journal output over parsing ANSI terminal output;
- escape output and never render log content through `innerHTML`;
- redaction may be defense-in-depth but is not the primary secret boundary;
- unknown or unregistered sources fail closed.

### UI

- source picker;
- range selector;
- search;
- live follow;
- pause;
- wrap/no-wrap;
- copy selected lines;
- jump to newest;
- bounded DOM/virtualized rendering for long sessions.

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

Terminal source exists for separately gated future activation, but production terminal/PTTY remains absent/fail-closed. Source presence is not activation evidence. Any terminal activation, host permission change, systemd activation, or other trust-boundary mutation requires a separate explicit owner authorization.

## Why the terminal is isolated

Browser terminals raise the security requirements of the whole scripting context. Keeping PTY execution in a separate contained normal-user terminal agent prevents free-form shell capability from inheriting Docker Engine authority or the main agent's host/journal evidence privileges.
