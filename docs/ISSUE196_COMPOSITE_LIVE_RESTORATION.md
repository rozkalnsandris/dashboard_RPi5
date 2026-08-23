# Issue #196 — Composite Live restoration gate

This document defines the **source-only** operator contract for the final live restoration of the read-only dashboard evidence chains tracked by issue #196.

Nothing in this document or the associated script authorizes production mutation. Merge authorization is not live authorization.

## Reviewed source anchors

Dashboard functional base:

- commit: `fb8b6067ae12eacfbfc21d2c104602f7fa257c1f`
- tree: `ec859e2b1d5c74be47986305d126dacf75093e0e`

Authoritative producer merge:

- repository: `rozkalnsandris/RPi5_main`
- reviewed producer commit: `dff7d6346140f8be98c2edb09a6663d80688e0d7`

The operator resolves the future dashboard target from fresh GitHub `main`. It accepts only descendants of the functional base whose post-base diff is limited to this final #196 rollout/log-advertisement gate. It also requires the reviewed producer commit to remain an ancestor of current `RPi5_main/main` and verifies exact producer blob pins before any live action.

## Why another source gate is required

The #196 audits found two distinct classes of failure:

1. missing/incorrect live evidence integration:
   - Prometheus target mismatch;
   - missing backup/endpoint/maintenance/deploy/throttle evidence producers;
   - Docker stats nested timeout too small;
2. selectable log sources that production could not read with the reviewed least-privilege agent identity.

The second problem must not be "fixed" by adding `adm`, `systemd-journal`, `video`, direct Docker or root authority to the dashboard agent. The final source correction therefore advertises only the two broker-backed Docker log sources that are actually live-capable under the current boundary. Dormant journal/root-only file registrations stay fail-closed and can be reintroduced only through a separately reviewed narrow capability.

## Preflight-only mode

Run only after this operator is merged to current dashboard `main`:

```bash
bash tools/operator/issue196-composite-live-restoration.sh --preflight-only --run-backup
```

`--run-backup` is optional and **OFF by default**. Including it only binds the future receipt to one real backup run; preflight itself does not execute a backup.

Preflight is production read-only. It may write only below the invoking user's cache in order to build and validate the exact candidate. Where root-owned `0750` maintenance files must be identified, it uses bounded read-only `sudo` calls only for `git hash-object` / `sha256sum`; it does not alter those files or their metadata.

It verifies:

- fresh dashboard and producer GitHub `main`;
- successful exact-main push CI for both repositories;
- dashboard functional-base ancestry and an allowlisted final #196 diff only;
- producer reviewed-commit ancestry plus exact blob pins;
- current production release pointer;
- broker/agent/web baseline active state;
- no forbidden `docker`, `video`, `adm`, or `systemd-journal` membership on the dashboard agent;
- terminal socket remains absent/inactive;
- current `/usr/local/sbin/rpi5-backup` is the reviewed pre-evidence V25 serialized wrapper (`bcf43633a61139153e3bac3b2c61f5118c742459`), root-owned `0750`;
- current `/usr/local/lib/rpi5-maintenance/rpi5-backup-v10-core` is the trusted byte-identical V10 ownership snapshot / runtime V12 core (`5ca85ae53bdf4fa3b99e21e1a30ddaa077d9e1791505b1e8389ee8587d011735`), root-owned `0750`;
- `/etc/dashboard-rpi5/web.env` remains a root-owned `0600` regular file without reading or printing its contents;
- Prometheus has one reviewed non-wildcard IPv4 `9090/tcp` host binding and responds to readiness/query probes;
- the raw Prometheus target is never written into GitHub evidence or printed by the operator; only its SHA-256 is stored in the receipt;
- exact production candidate install/audit/check/build/native/manifest/runtime smoke;
- current Cloudflare Access interception remains present;
- evidence producer has not already been unexpectedly activated.

A PASS receipt binds:

- dashboard target SHA;
- pre-deploy production SHA;
- current producer-main SHA;
- reviewed producer SHA;
- Prometheus target hash;
- backup-run YES/NO category;
- candidate manifest hash.

## Composite Live apply mode

Apply is valid only after a separate owner authorization that explicitly names:

- exact dashboard target SHA;
- exact host `rpi5`;
- #196 restoration scope;
- producer systemd installation/activation;
- dashboard release activation and bounded service restarts;
- exact single `DASHBOARD_PROMETHEUS_URL` production environment-key replacement;
- backup-wrapper cutover;
- whether **one real backup execution** is included;
- explicit exclusions: no identity/group expansion, no Docker-authority expansion, no Cloudflare mutation, no terminal/PTTY activation.

The apply command requires both the immutable preflight receipt SHA-256 and the exact acknowledgement:

```text
AUTHORIZE_ISSUE196_COMPOSITE_LIVE_RESTORATION
```

Before the first mutation, apply revalidates the whole receipt boundary and executes the release controller in PLAN mode.

The first live write consumes the authorization.

## Bounded mutation sequence

After all pre-write checks pass:

1. activate the exact dashboard release through the reviewed production release controller;
2. restart only the reviewed Docker broker and dashboard agent, verifying the existing web trust chain after each;
3. install exact reviewed producer files from the pinned `RPi5_main` producer commit:
   - sanitized evidence helper;
   - maintenance lock helper;
   - evidence collector wrapper;
   - byte-identical V10 backup core as `root:root 0750`;
   - evidence-aware serialized backup wrapper as `root:root 0750`, preserving the reviewed V25 execution boundary;
   - exact evidence service/timer;
4. `systemctl daemon-reload`, enable/start only the evidence timer, and start one evidence oneshot to seed required endpoint/throttle evidence and maintenance evidence when a valid maintenance invocation exists;
5. atomically replace/add only `DASHBOARD_PROMETHEUS_URL` in `/etc/dashboard-rpi5/web.env`, preserving every other line and root-owned `0600` metadata; the target is rediscovered locally and never printed;
6. restart only the dashboard web service;
7. if and only if the receipt and owner Composite Live authorization include `--run-backup`, execute exactly one `/usr/local/sbin/rpi5-backup`;
8. run final acceptance;
9. only after the preceding acceptance passes, write the bounded deployment evidence receipt and require `/api/deployments` to return HTTP 200.

No automatic rollback or cleanup is part of this transaction.

## Acceptance

The one-shot requires:

- `/api/health` = 200;
- `/api/current/host` = 200;
- `/api/current/docker` = 200 and all running containers expose available detailed stats;
- `/api/services` = 200;
- `/api/history/host?range=24h` = 200;
- `/api/endpoints` = 200;
- `/api/logs/sources` = 200 and advertises exactly:
  - `docker:homeassistant`
  - `docker:prometheus`
- Docker Prometheus logs = 200;
- endpoint and throttle evidence files are root-owned `0644` regular files; maintenance evidence, when produced, is also root-owned `0644`;
- backup entrypoint and immutable core remain root-owned `0750` regular files after cutover;
- `/api/backups` = 200 when the live envelope includes one real backup run;
- exact production release pointer equals the authorized dashboard target;
- dashboard agent still has no forbidden broad groups;
- terminal remains absent/inactive;
- unauthenticated public access remains intercepted by Cloudflare Access;
- after the bounded deployment receipt is recorded, `/api/deployments` = 200.

If `--run-backup` is omitted, backup evidence is intentionally deferred until the next successful scheduled backup and issue #196 must remain open until that evidence is observed.

## Fail-closed rule

Once `MUTATION_STARTED=YES`, **any** error, ambiguity or drift means:

```text
RESULT=STOP_AFTER_MUTATION_ERROR
NO_RETRY_ROLLBACK_CLEANUP=YES
```

Preserve evidence and stop. Do not retry, roll back, clean up, reset, rebase, run an extra restart, widen a permission, or choose an alternate mutation path without a new exact owner authorization.

## Explicit non-scope

This transaction does not authorize:

- Cloudflare DNS/Tunnel/Access changes;
- agent `docker`, `video`, `adm`, or `systemd-journal` group membership;
- generic Docker socket access;
- chmod/chgrp relaxation of raw backup logs;
- backup entrypoint/core permission widening beyond the reviewed V25 `0750` boundary;
- new generic journal/root/filesystem proxies;
- Quick Command changes;
- terminal/PTTY installation or activation;
- sudo/root access from the browser/dashboard agent;
- package upgrades or unrelated host maintenance.
