# #151 agent + web cutover continuation

## Status

The #151 permission recovery no longer has a broker failure to repair.

The owner-authorized historical recovery:
- normalized the exact target release metadata;
- started the broker exactly once;
- then stopped because the old helper tested broker socket metadata before application readiness was established.

The immutable PR #156 read-only diagnostic later proved the already-started broker is healthy:

- `MainPID=1081746`;
- `NRestarts=14582`, stable;
- cwd is exact target `4295c23...`;
- runtime directory is `0750`;
- broker socket is `0660`;
- broker health, Docker current-state, Home Assistant logs and Prometheus logs are `200`;
- forbidden log range and Docker-events broker route remain `404`;
- `/usr/bin/node=24.19.0`, so the v24 `import.meta.main >=24.2` boundary is satisfied.

The main agent and web processes were never cut over by the consumed recovery and still run release `15f44e3...`. Docker current-state already returns 200 through the recovered broker, while Docker Logs through the old agent remain 503.

## Primary-documentation readiness rule

The remaining systemd units also use `Type=exec`:

- `dashboard-rpi5-agent.service`;
- `dashboard-rpi5-web.service`.

systemd documents that `Type=exec` reports successful process execution setup, not completion of application initialization. Node server listen APIs are asynchronous and signal readiness only after the listening endpoint is established.

Therefore the continuation must use bounded application-level readiness:

### Agent

After exactly one authorized agent restart:

1. service stays active;
2. `MainPID` changes once and remains stable;
3. `NRestarts` does not increase;
4. cwd becomes the exact target release;
5. privileged agent socket observation proves exact `dashboard-rpi5-agent:dashboard-rpi5-agent-client:660:socket`;
6. host summary becomes 200;
7. Docker current-state becomes 200;
8. Home Assistant and Prometheus Docker Logs become 200 and satisfy the log snapshot schema;
9. Docker events remain 503;
10. Quick Commands remain 200 with the fixed four-command catalog;
11. terminal remains absent;
12. agent runtime groups include only the broker-client capability required by the unit, never direct Docker/video authority.

Only after all agent checks pass is web restart allowed.

### Web

After exactly one authorized web restart:

1. service stays active;
2. `MainPID` changes once and remains stable;
3. `NRestarts` does not increase;
4. cwd becomes the exact target release;
5. loopback `/api/health` becomes 200;
6. `/`, host current-state and Docker current-state are 200;
7. Home Assistant and Prometheus `/api/logs` are 200 and schema-valid;
8. `/api/quick-commands` remains 200;
9. web process receives no broker-client, Docker or video runtime authority.

## Broker is now an invariant

The continuation contains **no broker mutation**.

Before the first mutation, after agent acceptance, and in final proof, it re-proves the exact accepted broker:
- PID `1081746`;
- `NRestarts=14582`;
- target cwd;
- exact runtime directory/socket metadata;
- health/Docker/approved logs 200;
- forbidden paths 404.

Any broker drift blocks or stops the continuation. It is never restarted as part of this gate.

## Mutation boundary

The only permitted production sequence encoded by the helper is:

`agent restart ONCE -> bounded agent acceptance -> broker reproof -> web restart ONCE -> bounded web acceptance -> final proof`

No:
- broker stop/start/restart;
- chmod/chown;
- release/current-pointer mutation;
- systemd unit/drop-in mutation;
- user/group mutation;
- Cloudflare mutation;
- terminal mutation;
- Docker-events mutation;
- Actions mutation;
- automatic retry;
- rollback;
- cleanup.

The helper supports a read-only `--preflight-only` mode. Recovery mode requires the exact acknowledgement string embedded in the immutable helper and still requires a separate owner authorization at execution time.

Any failure after the agent restart begins consumes the authorization and results in evidence + STOP.

## Long-term architecture

Issue #157 owns the separate post-incident design work:
- align the Node engine contract with `import.meta.main` or remove that dependency;
- evaluate keeping `Type=exec` with external application health, `Type=notify`, or systemd socket activation.

Those improvements are deliberately excluded from this production continuation.
