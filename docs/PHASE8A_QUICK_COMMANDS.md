# Phase 8A — bounded read-only Quick Commands

Phase 8A replaces the Terminal fixture buttons with a deliberately small diagnostic command registry. It does **not** introduce a shell, PTY, sudo path, Docker control surface, or production activation.

## Fixed command registry

The browser sees only these IDs, labels, and descriptions:

| ID | Agent executable | Fixed argv | Purpose |
|---|---|---|---|
| `host.uptime` | `/usr/bin/uptime` | `--pretty` | Human-readable host uptime |
| `host.kernel` | `/usr/bin/uname` | `-srmo` | Kernel and architecture |
| `host.disk-root` | `/usr/bin/df` | `-h --output=source,size,used,avail,pcent,target /` | Root filesystem usage |
| `host.failed-units` | `/usr/bin/systemctl` | `--failed --no-legend --plain --no-pager` | Current failed systemd units |

Executable paths and argv are private agent configuration and are never accepted from the browser. There is no PATH-based command selection.

## Execution boundary

The agent uses Node `child_process.spawn()` with:

- an absolute reviewed executable path;
- reviewed fixed argv;
- `shell: false`;
- a minimal fixed locale/systemd pager environment;
- a fixed 5 second request timeout;
- a 16 KiB combined stdout/stderr limit;
- at most one Quick Command child lifecycle at a time per agent process.

Request completion and child-process lifecycle completion are intentionally separate. When the 5 second request timeout fires, the HTTP request may return `OPERATION_TIMEOUT`, but the concurrency slot remains occupied until the child process reaches the authoritative `close` event and its stdio is closed.

Timeout or agent shutdown starts a bounded termination sequence:

1. send fixed `SIGTERM`;
2. wait a fixed 250 ms grace period;
3. if `close` has not occurred, send fixed `SIGKILL`;
4. keep the concurrency slot unavailable until `close` is actually observed.

The browser cannot choose either signal or the grace period. The executor's Fastify `onClose` hook aborts an active Quick Command and waits for its lifecycle completion so agent shutdown does not intentionally detach the child.

Exceeding the output limit sends `SIGKILL`, stops retaining further output, and reports source unavailable only after the child reaches `close`. A normal non-zero exit is returned as a bounded `FAILED` result instead of being presented as success. Spawn/source errors are likewise not treated as lifecycle completion before `close` when a child object exists.

Control characters are stripped/replaced before output leaves the agent. The web UI renders stdout/stderr only through React text content inside `<pre><code>`; command output is untrusted text and is never HTML.

## HTTP surfaces

Agent Unix-socket routes:

- `GET /v1/quick-commands`
- `POST /v1/quick-commands/run` with exact body `{ "commandId": <registered-id> }`

Browser-facing server routes:

- `GET /api/quick-commands`
- `POST /api/quick-commands/run` with the same exact command ID body

Both layers reject extra query/body selectors. The browser cannot supply executable, args, path, cwd, environment, timeout, signal, shell settings, container/service selectors, or arbitrary file paths. Browser responses use `Cache-Control: no-store`.

## Explicitly absent

Phase 8A contains no:

- free-form shell or xterm.js PTY;
- `sh -c` / `bash -c`;
- sudo or root escalation;
- Docker exec/run/restart/stop/remove/prune;
- systemctl start/stop/restart/enable/disable;
- package-manager commands;
- deployment, backup, or filesystem mutation commands;
- browser-controlled command arguments, timeout, or termination signal;
- Cloudflare or host permission changes.

## Activation boundary

This change is source-only. It does not install, restart, or change the production dashboard/agent service and intentionally leaves the existing agent health capability/version advertisement unchanged. Production activation is a separate owner-authorized action.

Because issue #237 changes the running agent's Quick Command process-lifecycle behavior, **Production deploy classification after merge: YES**. A merge does not authorize deployment.

Phase 7B physical Samsung Galaxy A55 production acceptance also remains deferred until a separately authorized production deployment exists.
