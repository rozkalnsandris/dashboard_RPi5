# Phase 9G — isolated native Linux PTY and ARM64 build gate

Status: source-only implementation for issue #61. No terminal socket, server bridge, systemd activation or production deploy.

## Security pivot

The first 9G sketch put `node-pty` in `apps/agent`. That design was rejected before PR creation.

The existing `dashboard-rpi5-agent` is the privileged-read boundary and may later need Docker/journal/host-read access. Upstream `node-pty` documents that child PTYs inherit the parent process permission level. Its Linux fork path can set UID/GID, but it does not clear supplementary groups before executing the shell. A full terminal inside the read agent could therefore inherit privileges that were intended only for observability.

The source-only read-agent systemd blueprint is also intentionally hardened with `ProtectHome=yes` and runs as the `dashboard-rpi5` service account, which is the wrong mount/identity boundary for an interactive terminal.

Phase 9G therefore introduces a separate workspace:

```text
apps/terminal-agent
```

The package is not a daemon yet. It does not listen on a socket and no existing route imports it.

## Native dependency decision

`node-pty` is pinned exactly to stable `1.1.0` in `@dashboard-rpi5/terminal-agent` only.

The ordinary repository CI remains:

```text
npm ci --ignore-scripts
```

A separate native matrix installs the locked dependency graph with lifecycle scripts disabled and then selectively rebuilds only `node-pty`.

The rebuild sets:

```text
npm_config_build_from_source=true
```

In node-pty v1.1.0 its own `scripts/prebuild.js` removes packaged prebuilds when that flag is set and forces the install script to fall through to `node-gyp rebuild`.

The native gate runs on:

- `ubuntu-24.04` / x64;
- `ubuntu-24.04-arm` / ARM64.

This is important because an upstream 1.2 beta release previously shipped an x86-64 binary under a Linux ARM64 prebuild path. The Phase 9G acceptance evidence is therefore a source build plus native-load smoke on both architectures, not merely package installation.

## Runtime identity gate

`loadTerminalNativePtyFactory()` fails before loading `node-pty` unless all of these are true:

- platform is Linux;
- architecture is x64 or arm64;
- effective UID exists and is greater than zero;
- effective GID exists and is greater than zero;
- OS user metadata matches the effective UID/GID;
- username is a bounded safe OS-name shape;
- home directory is absolute and not `/`;
- the runtime group list contains exactly the primary effective GID and no other supplementary group.

The last condition is deliberate. A terminal service identity with Docker, sudo, journal or other extra groups is rejected rather than silently inheriting those authorities.

Native module loading happens only after these checks.

## Fixed shell contract

The browser cannot select the executable or process configuration.

The adapter always uses:

```text
/bin/bash --noprofile --norc
```

Initial and resize dimensions are bounded to the Phase 9F contract:

- columns: 2..300;
- rows: 2..200.

The PTY starts in the validated effective user's home directory with a newly created environment containing only:

```text
HOME
USER
LOGNAME
SHELL
PATH
TERM
COLORTERM
LANG
```

It never spreads or copies `process.env`, so service secrets cannot accidentally become shell environment variables.

Direct adapter teardown sends a fixed `SIGHUP` through node-pty.

## Native smoke scope

The x64/ARM64 native CI smoke imports the actual rebuilt `node-pty` binding and executes only a fixed test command:

```text
/bin/bash --noprofile --norc -c <fixed printf marker>
```

No repository/user/browser input becomes an executable, argv, cwd or environment value in that smoke.

The smoke proves the rebuilt native binding loads, allocates a PTY, returns output and exits on both supported CI architectures.

The production identity policy is covered separately by deterministic unit tests with an injected runtime/native module.

## Process-tree containment is still a hard gate

Upstream node-pty v1.1.0 `UnixTerminal.kill()` sends a signal to the PTY shell PID. That is not a sufficient containment primitive for an adversarial interactive shell because a user can create detached/disowned descendants.

Therefore Phase 9G deliberately does **not** wire this native adapter into the Phase 9F lifecycle or the Phase 9E WebSocket.

Before any real terminal transport may use it, the next security phase must introduce per-session process containment, such as an isolated service/cgroup lifecycle, and prove that disconnect, idle expiry and absolute expiry remove the entire session process tree — including detached descendants.

A green Phase 9G native smoke must never be interpreted as approval to expose the PTY.

## What Phase 9G does not do

- no `node-pty` in `apps/server`;
- no `node-pty` in privileged-read `apps/agent`;
- no terminal-agent socket;
- no WebSocket-to-PTY bridge;
- no production user/group creation;
- no systemd installation or service start;
- no Cloudflare or Tunnel changes;
- no host package installation;
- no production environment value;
- no terminal activation.

## Next gate

The next phase must design and test the local terminal-agent transport and process-tree containment before any browser-visible PTY is possible. Production service identity/socket/systemd changes remain a separate explicit owner authorization after source review.

**Production deploy: NO.**
