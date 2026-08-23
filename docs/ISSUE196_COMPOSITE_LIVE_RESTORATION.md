# Issue #196 — Composite Live restoration and post-live correction

This document records the **source-only** operator contract used for the original live restoration of the read-only dashboard evidence chains tracked by issue #196 and the narrower correction required by the evidence observed after that transaction.

Nothing in this document or the associated scripts authorizes production mutation. Merge authorization is not live authorization.

## Current status

The original #196 Composite Live transaction has already been executed successfully enough to restore the major read-only surfaces: backup evidence, endpoint evidence, throttle state, Docker detail, Prometheus history and bounded Docker logs. Its owner authorization is consumed and **must not be reused**.

Post-live browser evidence exposed two source defects:

1. deployment evidence was recorded with the dashboard application release SHA even though Phase 6C compares production against `rozkalnsandris/RPi5_main`;
2. maintenance evidence used the evidence-collector observation time rather than the actual `rpi5-update.service` execution exit time.

The original `--apply` path is therefore retired and fails closed before mutation. It must not be retried. The only supported next live path, after the producer and dashboard source corrections are merged and freshly revalidated, is the separate `issue196-post-live-evidence-correction.sh` gate described below.

## Reviewed source anchors for the historical Composite Live

Dashboard functional base:

- commit: `fb8b6067ae12eacfbfc21d2c104602f7fa257c1f`
- tree: `ec859e2b1d5c74be47986305d126dacf75093e0e`

Authoritative producer baseline:

- repository: `rozkalnsandris/RPi5_main`
- reviewed producer commit: `dff7d6346140f8be98c2edb09a6663d80688e0d7`

The historical operator resolved the dashboard target from fresh GitHub `main`, verified exact producer blob pins, and restored the missing live read-only integrations without widening the dashboard agent into broad host authorities.

## Why the original source gate was required

The #196 audits found two distinct classes of failure:

1. missing/incorrect live evidence integration:
   - Prometheus target mismatch;
   - missing backup/endpoint/maintenance/deploy/throttle evidence producers;
   - Docker stats nested timeout too small;
2. selectable log sources that production could not read with the reviewed least-privilege agent identity.

The second problem was not fixed by adding `adm`, `systemd-journal`, `video`, direct Docker or root authority to the dashboard agent. Only the two broker-backed Docker log sources that were actually live-capable under the current boundary were advertised.

## Historical preflight-only mode

The original source gate exposed:

```bash
bash tools/operator/issue196-composite-live-restoration.sh --preflight-only --run-backup
```

`--run-backup` in preflight only bound the future receipt to one real backup run; it did not execute a backup.

The historical preflight verified fresh dashboard and producer GitHub `main`, exact-main push CI, reviewed dashboard/producer lineage, production release state, broker/agent/web trust boundaries, the V25 backup wrapper/core split, root-owned web environment metadata, the Prometheus target, candidate build/smoke, Cloudflare Access interception and absence of terminal activation.

The original apply authorization has now been consumed. The corresponding `--apply` path is intentionally retired and fails closed before its first mutation.

## Historical Composite Live mutation sequence

The consumed transaction performed the reviewed bounded restoration:

1. activated the exact dashboard release;
2. restarted only the reviewed Docker broker and dashboard agent with trust checks;
3. installed the reviewed producer helper/collector, backup core/wrapper and evidence service/timer;
4. enabled/started the evidence timer and seeded one evidence oneshot;
5. atomically added/replaced only `DASHBOARD_PROMETHEUS_URL` while preserving the root-owned `0600` web environment;
6. restarted only the dashboard web service;
7. executed exactly one backup because that category was bound in the owner authorization;
8. ran final acceptance;
9. **historically, the operator then wrote a deployment evidence record using the dashboard target SHA.** This step was later proven semantically wrong for Phase 6C and must not be repeated.

The observed live result proved that the core restoration succeeded, but the deployment page correctly remained `UNKNOWN` because `f80da3848d7e` is a dashboard release commit and is not a commit in `RPi5_main`.

## Correct deployment authority

The deployment page contract is explicitly about `rozkalnsandris/RPi5_main`. Its production commit must therefore originate from the authoritative `RPi5_main` controlled-deploy state, not from the dashboard release controller.

The corrected producer projects only the latest successful transaction selected by the fixed root-owned `/var/lib/rpi5-deploy/latest-success` state. It validates:

- transaction schema `rpi5.controlled-deploy-transaction.v1`;
- repository exactly `rozkalnsandris/RPi5_main`;
- successful transaction status;
- transaction-id / 12-char commit agreement;
- full 40-char commit agreement;
- UTC completion timestamp.

It copies only transaction id, short commit and completion time into browser-safe evidence. It never exposes deploy target paths, before/after fingerprints, logs, rollback material or arbitrary state files.

## Correct maintenance time authority

The corrected producer continues to avoid broad journal access. It reads only fixed `systemctl show rpi5-update.service` properties:

- `ActiveState`;
- `InvocationID`;
- `Result`;
- `ExecMainExitTimestamp`.

The event `occurredAt` now comes from the unit's actual `ExecMainExitTimestamp`. For an already-retained invocation with the same result, the producer may replace only the old collector-time timestamp and re-sort the bounded event list. A conflicting result for the same invocation fails closed.

## Post-live correction preflight

After both source corrections are merged and current mains are freshly revalidated, use only:

```bash
bash tools/operator/issue196-post-live-evidence-correction.sh --preflight-only
```

This preflight is production read-only. It may write only under the invoking user's cache to clone and validate the exact producer source. It binds:

- fresh dashboard `main` SHA and successful exact-main `CI`;
- fresh producer `main` SHA and successful exact-main `Validate`;
- current dashboard production release still exactly `f80da3848d7e8981f096aed4b43d3ff251ab383b`;
- current live evidence helper/collector are exactly the pre-fix blobs installed by the consumed Composite Live;
- corrected producer helper/collector exact Git blobs from current `RPi5_main/main`;
- broker, agent, web and evidence timer remain active;
- evidence service is not failed;
- dashboard agent still lacks `docker`, `video`, `adm` and `systemd-journal` groups;
- terminal remains absent/inactive;
- current `/api/deployments` still exhibits the exact pre-fix `UNKNOWN` state with dashboard short commit `f80da3848d7e`.

A PASS receipt contains only the exact SHA/blob bindings and explicit no-mutation categories. Preflight does not install files, start/restart services, run a backup or change evidence.

## Post-live correction apply gate

Apply requires a **new separate owner authorization** and the immutable preflight receipt SHA-256. The exact acknowledgement is:

```text
AUTHORIZE_ISSUE196_POST_LIVE_EVIDENCE_CORRECTION
```

This authorization is not implied by the original Composite Live, by any merge, or by `turpini`.

Before the first write the apply path revalidates both GitHub mains/CI, the receipt, exact production release, exact old live producer blobs and all trust-boundary invariants.

After that, the only authorized mutations are:

1. replace `/usr/local/lib/rpi5-maintenance/dashboard-evidence.py` with the exact corrected producer blob as `root:root 0644`;
2. replace `/usr/local/sbin/rpi5-dashboard-evidence` with the exact corrected producer blob as `root:root 0755`;
3. start the **existing** `rpi5-dashboard-evidence.service` oneshot exactly once so the bounded evidence files self-correct.

It does **not** deploy dashboard source, change the current release, daemon-reload systemd, install/change units, enable/disable timers, restart broker/agent/web, execute backup/update/deploy, mutate controlled-deploy state, or change Cloudflare/terminal/identity/permissions.

## Post-live acceptance

The narrow correction requires:

- corrected helper and collector exact Git blobs and original root ownership/modes;
- existing evidence timer remains active;
- dashboard release remains exactly `f80da3848d7e8981f096aed4b43d3ff251ab383b`;
- dashboard agent group boundary remains unchanged;
- terminal remains absent/inactive;
- `/api/health` remains 200;
- `/api/deployments` resolves to repository `rozkalnsandris/RPi5_main`, has a real 12-char `RPi5_main` production commit, has a full GitHub-main SHA, and classification is no longer `UNKNOWN`;
- when a valid current `rpi5-update.service` invocation exists, `maintenance.json` contains that invocation at its actual normalized `ExecMainExitTimestamp`.

## Fail-closed rule

For both historical and correction gates, once `MUTATION_STARTED=YES`, **any** error, ambiguity or drift means:

```text
RESULT=STOP_AFTER_MUTATION_ERROR
NO_RETRY_ROLLBACK_CLEANUP=YES
```

Preserve evidence and stop. Do not retry, roll back, clean up, reset, rebase, run an extra restart, widen a permission, or choose an alternate mutation path without a new exact owner authorization.

## Explicit non-scope

The correction does not authorize:

- Cloudflare DNS/Tunnel/Access changes;
- agent `docker`, `video`, `adm`, or `systemd-journal` group membership;
- generic Docker socket access;
- chmod/chgrp relaxation of raw backup logs;
- backup entrypoint/core changes or backup execution;
- new generic journal/root/filesystem proxies;
- Quick Command changes;
- terminal/PTTY installation or activation;
- sudo/root access from the browser/dashboard agent;
- dashboard release activation or any broker/agent/web restart;
- systemd unit/timer installation, daemon-reload, enable/disable changes;
- package upgrades or unrelated host maintenance;
- any mutation of `/var/lib/rpi5-deploy` controlled-deploy state.
