# Terminal and Logs Security Contract

## Logs

### Browser contract

The browser supplies a stable `sourceId`, never a raw filesystem path or shell expression.

Examples:

```text
docker:homeassistant
docker:prometheus
systemd:cloudflared
systemd:dashboard-rpi5-agent
file:rpi5-backup
```

The server maps these IDs to registered sources.

### Implementation

- Docker logs through the supported Engine logs endpoint.
- Journal logs through fixed `journalctl`/journal queries.
- Prefer structured journal output over parsing ANSI terminal output.
- Apply maximum line count / bytes / duration.
- Escape all output.
- No `innerHTML`.
- Redact known secret patterns where practical, but never rely on redaction as the only control.

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

Quick Commands are the first terminal-like feature because they are useful on mobile and much safer than free-form shell.

Browser sends:

```json
{ "commandId": "docker-stats-once" }
```

Server mapping concept:

```text
commandId: docker-stats-once
executable: /usr/bin/docker
args: ["stats", "--no-stream", "--format", "..."]
timeout: 5s
maxOutput: bounded
```

Rules:

- `execFile`/`spawn` style argument arrays;
- no string concatenation;
- no normal `sh -c` path;
- fixed registered IDs;
- strict typed optional arguments if any are added later;
- owner-only;
- audit command ID, time, result and duration.

## Full terminal

Later phase only.

Frontend:

- xterm.js;
- local bundled assets;
- fit/search addons as needed;
- no third-party runtime scripts on the terminal page;
- clear connection state.

Backend:

- PTY owned by the local agent;
- normal owner user by default;
- no root default;
- no automatic sudo;
- `wss` externally through Cloudflare;
- authenticated owner revalidation before upgrade;
- origin validation;
- idle timeout;
- short max lifetime;
- low concurrency limit;
- kill PTY on disconnect/expiry.

Audit full-terminal sessions by session metadata by default. Do not persist every keystroke/output by default because terminal content can contain passwords/tokens/secrets.

## Why the terminal is isolated

Browser terminals raise the security requirements of the entire page because any JavaScript in the scripting context can potentially interact with terminal input/output. Keep the terminal route deliberately small and hardened.
