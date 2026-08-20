# #151 post-mutation readiness continuation

## Status

The first owner-authorized #151 recovery consumed its authorization and stopped fail-closed after the exact target metadata repair succeeded but broker acceptance did not complete. The existing recovery helper is historical evidence and must not be re-run against the changed live state.

The continuation is intentionally split into a **read-only diagnostic** and a later, separately owner-authorized mutation gate. `tools/operator/issue151-post-mutation-readonly.sh --read-only` performs no stop/start/restart, permission, identity, systemd-unit, Cloudflare, terminal, Docker-events, rollback, cleanup, or Actions mutation.

## Why `systemctl active` is not broker readiness

The installed broker unit uses `Type=exec`. systemd documents that `Type=exec` considers startup complete after the service binary has successfully reached `execve()`. It does not prove that application initialization or an IPC endpoint created by that application is ready. systemd recommends `Type=notify`/`notify-reload`, D-Bus activation, or another explicit readiness mechanism when follow-up work must wait for application initialization.

The broker creates its Unix socket from Node code. Node documents `net.Server.listen()` as asynchronous; readiness occurs when the `listening` event is emitted. Therefore a one-shot socket `stat` immediately after `systemctl start` is not a valid readiness barrier.

For the #151 continuation, the correct acceptance rule is application-level and bounded:

1. service remains `active`;
2. `MainPID` remains stable;
3. `NRestarts` remains stable;
4. process cwd is the exact target release;
5. runtime directory has exact expected metadata;
6. the Unix socket becomes observable through a **privileged** probe within a bounded wait;
7. socket metadata is exact;
8. broker `/v1/health`, Docker current-state and approved logs return their expected statuses;
9. forbidden paths remain fail-closed.

Only after that evidence may a future gate consider the broker accepted.

## Why socket existence probes must be privileged

The broker unit uses:

- `User=dashboard-rpi5-docker-broker`;
- `Group=dashboard-rpi5-docker-client`;
- `RuntimeDirectory=dashboard-rpi5-docker-broker`;
- `RuntimeDirectoryMode=0750`.

systemd documents that `RuntimeDirectory=` is created under `/run`, owned by the configured `User=`/`Group=`, with `RuntimeDirectoryMode=` controlling its access mode. An unrelated operator may be unable to traverse that directory. Consequently an unprivileged Bash `[ -S /run/.../broker.sock ]` can produce a false-negative observation. The continuation uses `sudo test -S` and `sudo stat` for socket/runtime-directory evidence, while HTTP probes run as the intended service/client identity.

## systemd architecture decision

No systemd unit mutation is part of this incident continuation.

`Type=exec` remains acceptable when the operator/deployment controller performs explicit application health acceptance before starting dependent cutover steps. If the project later wants systemd itself to express application readiness, evaluate a separate design:

- **Type=notify**: broker emits a readiness notification only after the socket is bound, secured and ready;
- **socket activation**: systemd owns the Unix listening socket and passes it to the broker.

Socket activation is the strongest IPC-lifecycle model but requires a broker protocol/startup refactor. `Type=notify` also requires an explicit notification implementation. Neither should be introduced as an emergency #151 production repair without its own review, tests and owner gate.

## Node compatibility note

The broker source uses `import.meta.main`. Node documents this API as added in Node `v24.2.0` (and `v22.18.0`). The repository currently declares Node `>=24 <25`, so Node 24.0/24.1 are nominally allowed even though this source feature is not available there. The read-only continuation prints the exact live Node version and whether the `>=24.2` boundary is met. A separate source-hardening change should either raise the minimum Node version to `>=24.2` or remove reliance on `import.meta.main`; this is not assumed to be the cause of the current incident without live version evidence.

## Production rule after the consumed authorization

The existing #151 owner authorization is consumed. The old helper must not be retried. After the read-only continuation classifies the broker state, any remaining mutation must be encoded in a new immutable helper/source revision and requires a new explicit owner authorization.

## References

Primary documentation used for this continuation design:

- systemd service startup semantics (`Type=exec`, readiness and socket activation): https://man7.org/linux/man-pages/man5/systemd.service.5.html
- systemd execution environment (`RuntimeDirectory=` / `RuntimeDirectoryMode=`): https://man7.org/linux/man-pages/man5/systemd.exec.5.html
- Node.js `net.Server.listen()` and the `listening` event: https://nodejs.org/download/release/latest-v24.x/docs/api/net.html
- Node.js ESM `import.meta.main` version history: https://nodejs.org/download/release/latest-v24.x/docs/api/esm.html
