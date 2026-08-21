# #157 Node runtime and broker readiness hardening

## Status

Source-only post-P3 hardening after the MVP working core (P0-P3) was accepted in production.

This work does **not** authorize or perform production, systemd, identity, Docker authority, terminal, Cloudflare, repository-settings, or GitHub Actions mutation.

## Node runtime contract

The Docker broker entrypoint and the main agent entrypoint still used `import.meta.main`. Node documents that property as available on the Node 24 line from v24.2.0, while the repository contract intentionally supports Node 24 generally (`>=24 <25`).

#157 removes that unnecessary 24.2-only dependency instead of narrowing the whole production engine contract for CLI-entry guards.

Selected contract:

- package engine remains `>=24 <25`;
- `package.json` and root `package-lock.json` engine metadata remain identical;
- the main agent and Docker broker share one compatibility-safe CLI guard in `apps/agent/src/cli-entry.ts`;
- the guard compares real paths for `process.argv[1]` and `fileURLToPath(import.meta.url)` and does not use `import.meta.main`;
- realpath comparison preserves direct execution through the production `/opt/dashboard_RPi5/current -> releases/<sha>` symlink;
- `.node-version` pins the reviewed Node 24 runtime to `24.19.0`;
- both GitHub Actions jobs read `.node-version` instead of an independent floating `24` selector;
- the existing production host-readiness contract continues to require Node major 24 and exact `/usr/bin/node`.

The earlier Node type-major mismatch was already resolved separately; this change addresses the remaining direct-entry runtime contract gap.

Primary Node documentation used for the historical gap:

- https://nodejs.org/download/release/latest-v24.x/docs/api/esm.html
- https://nodejs.org/en/blog/release/v24.2.0

## Broker readiness decision

Selected model: **keep `Type=exec` + mandatory bounded application-level readiness**.

Why:

- systemd `Type=exec` proves the service process was successfully executed; it does not prove application initialization or an application-created IPC endpoint is ready;
- the broker creates and secures its own AF_UNIX socket asynchronously;
- the #151 incident and the later #126 partial-rollout recovery both demonstrated that process/service state and application readiness must be evaluated separately;
- the accepted P3 production path proved that bounded application probes can verify broker readiness without expanding the Docker authority boundary.

A broker acceptance must therefore prove all of the following, bounded in time:

1. service is active with a stable non-zero `MainPID`;
2. `NRestarts` is stable after the accepted post-start baseline is captured;
3. process cwd is the exact reviewed release;
4. runtime directory and broker AF_UNIX socket exist with exact reviewed owner/group/mode;
5. `/v1/health` is 200;
6. Docker current-state is 200;
7. approved Home Assistant and Prometheus Docker log probes are 200;
8. bounded Docker recent events through `/v1/docker/events/recent?since=<unix>&until=<unix>` are 200, with the protocol limits preserved;
9. unapproved log ranges remain fail-closed;
10. the main agent still has no direct Docker/video authority.

`ops/production/broker-readiness-contract.json` is the source contract for these invariants. The events entry reflects the already accepted P3 read capability; it does not add or mutate an events capability.

Primary systemd documentation:

- https://man7.org/linux/man-pages/man5/systemd.service.5.html
- https://man7.org/linux/man-pages/man5/systemd.socket.5.html
- https://man7.org/linux/man-pages/man3/sd_notify.3.html

## Why not Type=notify now

`Type=notify` can express readiness precisely through `READY=1`, but it requires a reviewed notification implementation in the daemon and a systemd unit change. That is a valid future improvement, not required for this focused source-hardening pass.

## Why not socket activation now

Systemd socket activation would make systemd own/bind the broker socket and pass the listening file descriptor to the daemon. It provides stronger IPC lifecycle semantics, but the current broker calls `server.listen({ path })` itself. Adopting socket activation therefore requires a larger startup/protocol refactor and separate rollout review.

## Regression contract

Tests must preserve:

- `package.json` and root `package-lock.json` Node engine metadata remain aligned;
- neither the main agent entrypoint nor the broker entrypoint uses `import.meta.main`;
- both entrypoints use the shared symlink-safe CLI guard;
- direct execution through the production `current` symlink is recognized while imports/unrelated paths remain non-entrypoints;
- `.node-version` pins the reviewed Node 24 runtime and CI consumes that file in both jobs;
- production host readiness continues to require Node major 24 at `/usr/bin/node`;
- broker unit remains `Type=exec` until a separately reviewed architecture change;
- `active` is never treated as sufficient application readiness;
- broker startup listens successfully before socket security is applied and listen errors reject startup;
- readiness requires stable PID/restart counter + socket metadata + application probes;
- current P3 Docker events reader wiring and bounded broker events protocol remain present;
- no Docker authority is added to the main agent;
- terminal/PTTY remains unrelated and fail-closed.

## P4 classification

This is the current post-P3 P4.4 runtime/readiness hardening workstream under #144/#157. Historical PR #159 remains a Draft design reference only and is not a merge candidate as-is.

## Production boundary

This document and its source contracts are architecture/source changes only. Any later production rollout requires a separate exact owner authorization.

```text
PRODUCTION_MUTATION_AUTHORIZATION=NONE
MERGE_AUTHORIZATION=NONE
ACTIONS_RERUN_AUTHORIZATION=NONE
```
