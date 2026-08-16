# Phase 11E — production host readiness evidence

Status: **source-only**.

This phase does not deploy the dashboard and does not authorize any RPi5, systemd, identity, filesystem or Cloudflare mutation.

## Purpose

Before the first production bootstrap, prove that the actual Raspberry Pi host does not already conflict with the reviewed production contract.

The verifier is intentionally narrower than an installer. It answers only:

> Is the current host state compatible enough to proceed to a separately owner-authorized bootstrap step?

A `READY` result is evidence, not authorization.

## Fixed production runtime

The reviewed base runtime is:

- Linux;
- `arm64`;
- Node.js major 24;
- Node executable `/usr/bin/node` because the reviewed systemd units use that exact path;
- PID 1 evidence must identify `systemd`;
- dashboard web port `8787` must be completely free before first bootstrap.

The Node runtime evidence uses Node's own `process.platform`, `process.arch`, `process.versions.node` and `process.execPath`; no shell command is required.

## Evidence sources

The production CLI accepts no path overrides and reads only fixed local sources:

```text
/etc/passwd
/etc/group
/proc/net/tcp
/proc/net/tcp6
/proc/1/comm
/run/systemd/system
/opt/dashboard_RPi5
/etc/dashboard-rpi5
/run/dashboard-rpi5
/run/dashboard-rpi5/agent.sock
/var/lib/dashboard-rpi5-terminal
/run/dashboard-rpi5-terminal.sock
/etc/systemd/system/dashboard-rpi5-*
/etc/systemd/system/*target.wants/dashboard-rpi5-*
```

It also reads the checked-in systemd blueprints from the same source tree as the verifier.

The verifier does not enumerate unrelated services, users, listeners, files or secrets.

## Identity semantics

The dedicated production identities may be completely absent before bootstrap.

If they already exist, the verifier requires the reviewed least-privilege shape:

- `dashboard-rpi5-web` primary group `dashboard-rpi5-web`;
- web may have only the reviewed `dashboard-rpi5-agent-client` supplementary group;
- web must not have `dashboard-rpi5-terminal-client` at base launch;
- `dashboard-rpi5-agent` primary group `dashboard-rpi5-agent-client` and no supplementary groups;
- `dashboard-rpi5-terminal` primary group `dashboard-rpi5-terminal` and no supplementary groups;
- expected dashboard users/groups may not collide with UID/GID 0;
- present dashboard users/groups must not share UIDs/GIDs;
- stale group membership for an absent dashboard user blocks.

The output reports only compatibility counts/state. It does not print UID/GID values or `/etc/passwd`/`/etc/group` contents.

## Port and socket semantics

The verifier parses `/proc/net/tcp` and `/proc/net/tcp6` directly.

Any listening socket on TCP port `8787` blocks first bootstrap, including loopback or wildcard listeners. This is deliberately stricter than checking only `127.0.0.1` because an unexpected listener is a conflict that must be understood before installation.

The fixed agent and terminal Unix socket paths must be absent before base bootstrap. Their presence indicates an already-running or stale capability and blocks.

## Filesystem semantics

The following may be absent or real directories:

- `/opt/dashboard_RPi5`;
- `/etc/dashboard-rpi5`;
- `/run/dashboard-rpi5`;
- `/var/lib/dashboard-rpi5-terminal`.

A symlink or special-file trap at one of those reviewed directory paths blocks.

This verifier does not validate release contents. Exact-SHA release integrity remains the responsibility of the Phase 11B/11D candidate manifest and release controller.

## systemd semantics

For the four reviewed source units:

```text
dashboard-rpi5-web.service
dashboard-rpi5-agent.service
dashboard-rpi5-terminal.socket
dashboard-rpi5-terminal@.service
```

An installed unit may be absent or a regular file that byte-matches the checked-in blueprint.

Any drift blocks.

Any reviewed enablement symlink that already exists blocks first bootstrap. In particular, the terminal socket must not already be enabled.

The verifier intentionally does not execute `systemctl`. Web/agent runtime activity is still indirectly fail-closed because a running base service would occupy the fixed TCP/Unix socket boundary. Runtime service activation remains a later owner-authorized step.

## Command

On the actual Raspberry Pi, from the exact reviewed source tree:

```text
npm run preflight:host
```

There are no CLI arguments and no alternate filesystem-root mode.

Expected successful shape is bounded JSON similar to:

```json
{
  "status": "READY",
  "runtime": { "platform": "linux", "arch": "arm64", "nodeMajor": 24 },
  "port": { "host": "127.0.0.1", "port": 8787, "state": "free" },
  "units": "absent-clean",
  "deploymentAuthorized": false
}
```

On missing, malformed or conflicting evidence the tool exits non-zero with `status=BLOCKED`.

## Explicit non-actions

The verifier contains no path that can:

- invoke a shell or `child_process`;
- call `systemctl`, `service`, `useradd`, `groupadd`, `usermod`, `sudo` or Docker;
- contact Cloudflare or any network endpoint;
- write, append, mkdir, rename, unlink, chmod, chown, copy or symlink host files;
- activate the Phase 11D release controller;
- enable Quick Commands;
- enable the full terminal.

## Later owner gate

After this source is merged, `turpini` still does **not** authorize running this against production if the step is being treated as live operational evidence, and it definitely does not authorize acting on a `READY` result.

The first real RPi5 bootstrap remains a separate explicit owner action under master issue #1. That later action must fresh-check exact `main`, exact-main CI, candidate SHA/manifest, host readiness evidence and the intended bounded mutation sequence before any write.

**Production deploy: NO.**
