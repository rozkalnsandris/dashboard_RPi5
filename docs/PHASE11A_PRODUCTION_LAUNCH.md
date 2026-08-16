# Phase 11A — production launch contract

Status: **source-only / not activated**.

Issue: #69. Master contract: #1.

Fresh baseline for this phase: `main` `7dee54f3fbdc6e97ea455dc7e864044b1ce154c0`, exact-main CI #231 / run `31945866826` = `SUCCESS`.

## Why Phase 11A exists

Phase 9 now contains the full terminal source chain, but merge completion is not production authorization. Phase 10 controlled write actions are also intentionally deferred because #1 requires a separate product/security decision before those capabilities exist.

Phase 11A therefore prepares only the deterministic launch boundary required by Phase 11. It does not deploy anything.

## Production identity model

The three runtime identities are intentionally distinct:

| Role | User | Primary group | Purpose |
|---|---|---|---|
| Web/API | `dashboard-rpi5-web` | `dashboard-rpi5-web` | loopback HTTP/WebSocket application |
| Read agent | `dashboard-rpi5-agent` | `dashboard-rpi5-agent-client` | bounded local host evidence API |
| Terminal worker | `dashboard-rpi5-terminal` | `dashboard-rpi5-terminal` | one contained PTY session |

Socket-client groups are capabilities, not generic application groups:

- `dashboard-rpi5-agent-client` permits connection to `/run/dashboard-rpi5/agent.sock`;
- `dashboard-rpi5-terminal-client` permits connection to `/run/dashboard-rpi5-terminal.sock`.

The base web blueprint receives only `dashboard-rpi5-agent-client`.

**The base web blueprint must not receive `dashboard-rpi5-terminal-client`.** Granting that group is part of a later explicit terminal activation because it expands the web process trust boundary.

The read-agent identity must never receive terminal-client membership. This prevents the privileged-read agent from becoming a path into the PTY boundary.

The terminal account must have no supplementary groups. In particular it must not inherit Docker, journal, systemd-control or read-agent groups.

## Immutable release layout

A future owner-authorized deployment must stage an exact commit as an immutable release directory:

```text
/opt/dashboard_RPi5/releases/<40-char-exact-sha>/
```

The active pointer is:

```text
/opt/dashboard_RPi5/current -> /opt/dashboard_RPi5/releases/<exact-sha>
```

Runtime units execute only from `/opt/dashboard_RPi5/current/...`.

This gives rollback a deterministic target: point `current` at a previously verified release and restart only through a separately authorized deployment operation. Phase 11A does not create the directory, symlink or restart anything.

Other future host paths:

```text
/etc/dashboard-rpi5/
/run/dashboard-rpi5/agent.sock
/run/dashboard-rpi5-terminal.sock
/var/lib/dashboard-rpi5-terminal/
```

## Web/API systemd blueprint

`ops/systemd/dashboard-rpi5-web.service` is source-only.

Key properties:

- `User=dashboard-rpi5-web`;
- loopback bind remains enforced in `apps/server/src/index.ts` as `127.0.0.1`;
- environment comes from `/etc/dashboard-rpi5/web.env`;
- base supplementary group is only `dashboard-rpi5-agent-client`;
- no terminal-client membership;
- no root capabilities;
- `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateDevices=yes`, `NoNewPrivileges=yes`;
- runtime comes from `/opt/dashboard_RPi5/current`.

Cloudflare Tunnel can later target the loopback service. No new router port-forward is part of this design.

## Base environment

`ops/production/web.env.example` is the canonical non-secret shape. It keeps:

```text
DASHBOARD_TERMINAL_ENABLED=disabled
```

The static root and agent socket are fixed production paths. Prometheus/Grafana settings are optional reviewed server-side targets.

No secrets or Access token values belong in Git.

## Terminal activation environment

`ops/production/terminal.env.example` exists only to document the later owner-gated inputs:

- `DASHBOARD_TERMINAL_ENABLED=enabled`;
- `DASHBOARD_TERMINAL_ACCESS_TEAM`;
- `DASHBOARD_TERMINAL_ACCESS_AUD`;
- `DASHBOARD_TERMINAL_OWNER_EMAIL`.

The required Access values are deliberately empty in the example. The application rejects enabled terminal admission when those values are absent/invalid.

A future terminal activation must make **two** independent changes under explicit owner authorization:

1. grant only `dashboard-rpi5-web` the `dashboard-rpi5-terminal-client` capability;
2. provide the reviewed terminal environment and enable the systemd terminal socket.

Neither is performed in Phase 11A.

## Terminal containment remains unchanged

The socket stays:

```text
ListenStream=/run/dashboard-rpi5-terminal.sock
SocketGroup=dashboard-rpi5-terminal-client
SocketMode=0660
Accept=yes
MaxConnections=1
```

`Accept=yes` gives each accepted connection its own service instance. The worker remains systemd-cgroup contained with:

- `KillMode=control-group`;
- `SendSIGKILL=yes`;
- `TimeoutStopSec=2s`;
- `RuntimeMaxSec=30min`;
- `PrivateNetwork=yes`;
- `ProtectControlGroups=yes`;
- no `Delegate=`;
- no supplementary groups.

The local Node protocol still owns the 5 minute idle timeout. systemd owns final process-tree cleanup.

## Read-only production preflight

Run shape for a **future already-staged candidate**:

```text
npm run preflight:production -- \
  --release /opt/dashboard_RPi5/releases/<exact-sha> \
  --sha <exact-sha>
```

The preflight only reads metadata/files. It checks:

- Linux;
- x64 or arm64;
- Node major 24;
- exact canonical release path matching the supplied 40-char SHA;
- required built artifacts;
- machine-readable launch contract;
- web/agent/terminal identity separation;
- base web terminal gate disabled;
- fixed agent/terminal socket paths;
- Unix-only terminal listener, mode/group and single connection;
- terminal cgroup cleanup/no supplementary groups/no delegation.

It contains no `child_process`, `systemctl`, user/group mutation or filesystem-write path. A failed check returns `BLOCKED` and changes nothing.

CI runs the same blueprint validators against repository source.

## Cloudflare launch boundary

A future Phase 11 production operation must configure `dash.rozkalns.net` as a Cloudflare Access-protected self-hosted application and Tunnel route only after explicit owner authorization.

Origin-side JWT validation remains mandatory. Terminal admission already validates `Cf-Access-Jwt-Assertion`, signature, issuer, audience and exact owner email before issuing a one-time terminal capability.

No Cloudflare API call, DNS change, Tunnel change, Access policy change or secret/token creation occurs in Phase 11A.

## Capability staging after base launch

Initial deployment does not need to activate every source capability at once.

Keep separately owner-gated where host privileges are involved:

- Docker socket access;
- journal group access;
- Pi device/group access needed by `vcgencmd`;
- Quick Commands enablement;
- full terminal connector membership/socket/feature gate.

Missing evidence must remain `UNKNOWN`/`UNAVAILABLE`, never healthy-looking zero.

## Rollback contract

Phase 11A prepares rollback structure but performs no rollback.

A future authorized rollback must identify:

- current exact release SHA;
- target previously verified release SHA;
- exact-main/production relationship;
- affected units;
- post-switch health checks.

Do not delete the previous verified release as part of the same activation operation.

## Explicit non-actions

Phase 11A does **not**:

- create users/groups;
- change group membership;
- create `/opt`, `/etc`, `/run` or `/var/lib` production paths;
- copy/install systemd units;
- call `systemctl`;
- start/restart/enable anything;
- grant Docker/journal permissions;
- enable Quick Commands;
- enable terminal;
- modify Cloudflare;
- deploy production.

**Production deploy: NO.**
