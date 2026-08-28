# Issue #226 read-only recovery preflight

`tools/operator/issue226-readonly-recovery-preflight.sh` is a source-controlled, fail-closed evidence helper for the partial production recovery tracked in issue #226.

It is **not** a deploy helper and it does not authorize or perform production recovery. Its purpose is to bind an already-built immutable candidate to freshly observed RPi5 state before a later Composite Live decision.

## Invocation

Run the helper from an already trusted execution context that has the read permissions needed for the production metadata and installed release manifest:

```bash
tools/operator/issue226-readonly-recovery-preflight.sh \
  --sha <exact-target-sha> \
  --candidate-root <immutable-candidate-root> \
  --manifest <candidate-manifest>
```

The candidate must already exist outside `/opt/dashboard_RPi5`. The helper does not build, regenerate, copy, install, activate or clean up a candidate. It never invokes privilege escalation; insufficient read permission fails closed.

## Evidence boundary

The helper collects only public-safe metadata and status needed by the #226 recovery gate:

- exact `/opt/dashboard_RPi5/current` release pointer and absence of the target release/controller lock;
- Docker broker, agent, web and log-broker systemd state, PID, CWD, restart count and result;
- terminal socket state;
- agent supplementary groups and rejection of broad `docker`, `adm`, `systemd-journal`, `sudo` or `root` membership;
- exact log-broker socket owner/group/mode/type;
- broker `/v1/health` status and one fixed `systemd:ssh` read status, with the response body discarded;
- effective Quick Commands enablement plus production drop-in metadata and SHA-256, without printing the effective environment;
- `/var/log/rpi5-backup.log` owner/group/mode/type, without reading its contents;
- SHA-256 identities for installed and candidate agent/log-broker unit files;
- presence and size of the candidate `apps/agent/dist/log-broker-entry.js`;
- GET-only product-path health for health, host, Docker, log-source catalog and Quick Commands;
- exact candidate-manifest verification;
- `production-release-controller` **PLAN only** for the supplied exact SHA.

The `/api/current/docker` outer client timeout is 12 seconds. The canonical server path allows up to 10 seconds, and the earlier 5-second #226 recovery guard produced a confirmed false negative.

A valid activation plan must remain bound to the freshly observed current release, report the target release as absent, and contain only these ordered operations:

1. `copy_manifest_allowlisted_release`
2. `write_verified_manifest_marker`
3. `atomic_current_symlink_swap`

Any drift or unavailable mandatory evidence returns `RESULT=BLOCKED`.

## Explicit exclusions

The helper has no path for:

- release-controller apply;
- service start, stop, restart, enable, disable, reload, reset-failed or daemon-reload;
- user/group/permission/ownership mutation;
- Docker authority mutation;
- Cloudflare mutation;
- Quick Commands configuration mutation;
- terminal activation/session creation;
- candidate build/copy/install/cleanup;
- secret or raw log output.

A `READ_ONLY_RECOVERY_PREFLIGHT_PASS` receipt is evidence only. It does not make any previous owner authorization reusable and does not authorize a merge or production mutation. After the evidence is reviewed, any later recovery mutation must be frozen into a fresh exact Composite Live envelope and separately owner-authorized.

Current production state and authorization state remain canonical in GitHub issue #226.
