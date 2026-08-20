# #157 Node runtime and broker readiness hardening

## Status

Source-only post-incident hardening after #151/#127 production acceptance completed successfully.

This work does **not** authorize or perform production, systemd, identity, Docker authority, terminal, Docker-events, or Cloudflare mutation.

## Node runtime contract

The broker entrypoint uses `import.meta.main`. Node documents that property as available in Node 24 from v24.2.0. The old repository contract (`>=24 <25`) therefore admitted Node 24.0/24.1 even though source relied on a feature that those versions do not provide.

Selected contract:

- package engine: `>=24.2 <25`;
- reviewed developer/CI runtime: `.node-version`;
- GitHub Actions reads `.node-version` rather than an independent floating `24` selector;
- production host-readiness contract declares `nodeMinimum=24.2.0`;
- `npm run preflight:host` runs a compatibility-safe Node runtime verifier before the existing filesystem/identity/systemd host-readiness verifier.

The runtime verifier intentionally does **not** use `import.meta.main`; it uses an entrypoint comparison based on `fileURLToPath(import.meta.url)` so Node 24.0/24.1 can execute the verifier and be rejected before any deployment/activation work.

Primary Node documentation:

- https://nodejs.org/download/release/latest-v24.x/docs/api/esm.html
- https://nodejs.org/en/blog/release/v24.2.0

## Broker readiness decision

Selected model: **keep `Type=exec` + mandatory application-level readiness**.

Why:

- systemd `Type=exec` proves the service process was successfully executed; it does not prove application initialization or an application-created IPC endpoint is ready;
- the broker creates and secures its own AF_UNIX socket asynchronously;
- #151 demonstrated that checking service state or socket state at the wrong time can produce a false recovery classification;
- the successfully recovered production path already proved that bounded application probes are effective without expanding the broker's authority boundary.

A broker acceptance must therefore prove all of the following, bounded in time:

1. service is active with a stable non-zero `MainPID`;
2. `NRestarts` is stable;
3. process cwd is the exact reviewed release;
4. runtime directory and broker AF_UNIX socket exist with exact reviewed owner/group/mode;
5. `/v1/health` is 200;
6. Docker current-state is 200;
7. approved Home Assistant and Prometheus Docker log probes are 200;
8. unapproved log ranges and Docker events remain fail-closed;
9. the main agent still has no direct Docker/video authority.

`ops/production/broker-readiness-contract.json` is the source contract for these invariants.

Primary systemd documentation:

- https://man7.org/linux/man-pages/man5/systemd.service.5.html
- https://man7.org/linux/man-pages/man5/systemd.socket.5.html
- https://man7.org/linux/man-pages/man3/sd_notify.3.html

## Why not Type=notify now

`Type=notify` can express readiness precisely through `READY=1`, but it requires a reviewed notification implementation in the daemon and a systemd unit change. That is a valid future improvement, not required to close the structural gap exposed by #151.

## Why not socket activation now

Systemd socket activation would make systemd own/bind the broker socket and pass the listening file descriptor to the daemon. It provides stronger IPC lifecycle semantics, but the current broker calls `server.listen({ path })` itself. Adopting socket activation therefore requires a larger startup/protocol refactor and separate rollout review.

## Regression contract

Tests must preserve:

- Node versions below 24.2 fail closed;
- package engine, `.node-version`, CI and production host readiness stay aligned;
- broker unit remains `Type=exec` until a separately reviewed architecture change;
- `active` is never treated as sufficient readiness;
- broker startup listens successfully before socket security is applied and listen errors reject startup;
- readiness requires stable PID/restart counter + socket metadata + application probes;
- no Docker authority is added to the main agent;
- no terminal/events capability is activated.

## Production boundary

This document and its source contracts are architecture/source changes only.

```text
PRODUCTION_MUTATION_AUTHORIZATION=NONE
MERGE_AUTHORIZATION=NONE
ACTIONS_RERUN_AUTHORIZATION=NONE
```
