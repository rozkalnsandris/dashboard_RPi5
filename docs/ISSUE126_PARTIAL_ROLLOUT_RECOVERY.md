# Issue #126 partial rollout recovery

## Status

Source-only recovery staging after the owner-authorized P3 activation stopped at the broker readiness gate.

This document does **not** authorize production mutation.

## Observed partial production state

The consumed activation attempt successfully applied the prepared P3 release and moved `/opt/dashboard_RPi5/current` from `4295c23de5634dcb86b5fe9f57be92416eb9a75b` to `a39fc7a9873eedb58cfa49568f9b2e05483cf7c2`.

The Docker broker restart also succeeded in production, but the activation helper stopped because its readiness function required the post-restart `NRestarts` value to equal the pre-restart value. The broker had accumulated `NRestarts=14582` before the explicit restart; after the clean manual `systemctl restart`, systemd exposed `NRestarts=0`. The helper therefore returned its NRestarts mismatch path even though the broker was active and healthy on the target release.

Read-only evidence after the STOP proved:

```text
current=a39fc7a9873eedb58cfa49568f9b2e05483cf7c2
node=v24.19.0
import.meta.main=true

broker:
  active/running/result=success
  pid=2140814
  nrestarts=0
  cwd=a39fc7a9873eedb58cfa49568f9b2e05483cf7c2
  health=200
  docker=200

agent:
  pid=1202029
  nrestarts=0
  cwd=4295c23de5634dcb86b5fe9f57be92416eb9a75b
  host=200
  events=503

web:
  pid=1202343
  nrestarts=0
  cwd=4295c23de5634dcb86b5fe9f57be92416eb9a75b
  health=200
  activity=200

terminal=absent
```

The historical Node runtime hypothesis is disproved for this incident. The production host is on Node 24.19.0 and `import.meta.main` is present and true for a direct module invocation.

## Root cause

The activation helper treated `NRestarts` as if an explicit manual `systemctl restart` must preserve the counter:

```text
pre-restart NRestarts == post-restart NRestarts
```

That invariant is false on the production host. The readiness contract needs **post-restart stability**, not equality with the pre-restart counter.

For a controlled restart, the safe invariant is:

1. the new MainPID must differ from the pre-restart MainPID;
2. capture the first numeric `NRestarts` observed for that new MainPID;
3. while waiting for application readiness, both that new MainPID and the captured post-restart `NRestarts` value must remain stable;
4. final acceptance must still observe the same MainPID and same captured post-restart `NRestarts` value.

Any PID change or `NRestarts` change after the new baseline is captured is a fail-closed restart/crash signal.

## Why the original activation helper must not be rerun

The original one-shot authorization is consumed. In addition, its production preflight intentionally expects the old release to be current and the target release to be absent. Both facts are now false after the successful release apply.

Therefore recovery must not use retry, rollback, cleanup, release re-apply, broker re-restart, or an alternate mutation path by implication.

## Bounded recovery contract

A dedicated recovery helper may be prepared source-only. Before any mutation it must fail closed unless all of the following are freshly true:

- GitHub `main` is the exact reviewed recovery-PR squash descendant of the current canonical base;
- natural exact-head CI for the recovery PR is fully successful;
- the target release is `a39fc7a9873eedb58cfa49568f9b2e05483cf7c2` and its installed candidate marker matches the prepared immutable candidate evidence;
- `/opt/dashboard_RPi5/current` already points at that target release;
- release-controller lock is absent;
- installed broker/agent/web units remain byte-equal to the target source;
- broker remains active on the target release with stable PID/NRestarts, exact socket and Docker authority boundaries, health/Docker/logs success, bounded recent-events success, and forbidden raw events path fail-closed;
- agent remains active on the previous release, retains no persistent/runtime Docker or video authority, and still exposes host/Docker/logs/Quick Commands while bounded events remain 503;
- web remains active on the previous release with health/current/Docker/Quick Commands/Activity success;
- terminal remains absent and Cloudflare Access remains 302.

The recovery mutation boundary is only:

1. restart `dashboard-rpi5-agent.service` exactly once;
2. require new PID, target cwd, stable post-restart NRestarts baseline, broker-client runtime group present, Docker/video runtime groups absent, and host/Docker/logs/Quick Commands/events acceptance;
3. restart `dashboard-rpi5-web.service` exactly once;
4. require new PID, target cwd, stable post-restart NRestarts baseline, health/current/Docker/Quick Commands/Activity acceptance;
5. final acceptance proving current pointer and broker stayed unchanged, agent/web remained on their accepted new PIDs and post-restart NRestarts baselines, events/Activity are 200, terminal remains absent, and Access remains 302;
6. STOP.

The recovery helper must contain no release apply, broker restart, daemon-reload, service enable/disable/start/stop/reset-failed, identity/group mutation, permission widening, Docker authority widening, terminal activation, Cloudflare mutation, Actions mutation, cleanup, automatic retry, or rollback.

Any failure or ambiguity after the first recovery mutation starts must preserve evidence and STOP. A new owner decision is required for any further mutation.

## Authorization state

```text
ORIGINAL_PRODUCTION_ACTIVATION_AUTHORIZATION=CONSUMED
RECOVERY_PRODUCTION_MUTATION_AUTHORIZATION=NONE
RETRY_AUTHORIZATION=NONE
ROLLBACK_AUTHORIZATION=NONE
CLEANUP_AUTHORIZATION=NONE
ACTIONS_RERUN_AUTHORIZATION=NONE
```
