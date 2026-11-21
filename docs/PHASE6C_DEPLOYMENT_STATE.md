# Phase 6C — deployment state

Status: source-only implementation. Production deploy: **NO**.

## Purpose

Phase 6C shows whether the controlled `rozkalnsandris/RPi5_main` production state is aligned with GitHub `main` without introducing a deployment write path.

The page is evidence correlation, not a deployment controller.

## Production evidence

Production commit evidence comes from the sanitized local deployment-evidence source produced from the authoritative `RPi5_main` controlled-deploy state.

The authoritative controlled-deploy success pointer is `/var/lib/rpi5-deploy/latest-success`, backed by a successful `rpi5.controlled-deploy-transaction.v1` transaction for exactly `rozkalnsandris/RPi5_main`. The root evidence producer validates that private state and publishes only the bounded dashboard deployment event contract. The browser/server consumer never receives the private transaction JSON or rollback data.

Missing authoritative success state deliberately produces an empty verified-deploy window. Phase 6C then reports `UNKNOWN`; it never invents a production commit from a dashboard release or from GitHub `main`.

## GitHub evidence

The server has one purpose-built public REST client for exactly:

`rozkalnsandris/RPi5_main`

The browser cannot choose the repository, branch, ref, compare range or URL.

The client performs only fixed GET requests for:

1. branch `main`;
2. the 12-character verified production commit, which must resolve to a full 40-character SHA with the same prefix;
3. when required, `productionFull...mainFull` comparison.

No GitHub App token, PAT, cookie or `Authorization` header is supported in Phase 6C. The repository is public. Successful correlation results are cached server-side for five minutes so a normal dashboard refresh does not become GitHub polling.

Each request has a three-second timeout, redirects are rejected and the decoded response is capped at 2 MiB.

## Compare completeness

GitHub compare responses expose at most 300 changed files. The production-impact decision must not silently rely on a potentially truncated list.

A response containing **300 files** is incomplete. If and only if the same compare response proves `ahead_by > 0` and `behind_by = 0`, the server requests the two **recursive Git trees** for the exact resolved production and main commit SHAs. Both responses must be complete (`truncated=false`), carry the exact requested SHA, and pass the existing 3-second timeout and 2-MiB decoded response caps. For each of the ten reviewed production-impact paths, compare immutable blob SHA plus file mode; a path present at only one endpoint is changed. A rename into or out of a reviewed path therefore counts as an impact. Unrelated tree changes do not affect the production-impact classification.

If either tree is unavailable, truncated, malformed, internally inconsistent, or exceeds a bound, keep `UNKNOWN`. Never infer `MAIN_AHEAD_NO_DEPLOY` from the capped compare list alone. The ordinary compare path (fewer than 300 files) remains unchanged and checks renames using both `filename` and `previous_filename`. This fallback adds only two fixed public GitHub GET requests; it provides no deploy capability.

## Reviewed production-impact policy

The exact path allowlist follows the current `RPi5_main` controlled-deploy target sources plus its manifest and deploy-engine inventory:

- `ops/bin/rpi5-backup`
- `ops/bin/rpi5-backup-serialized`
- `ops/lib/rpi5-maintenance-locks.sh`
- `ops/cron.d/rpi5-backup`
- `ops/logrotate.d/rpi5-backup`
- `ops/deploy/targets.json`
- `scripts/rpi5-deploy`
- `scripts/rpi5_deploy.py`
- `scripts/rpi5_deploy_lib.py`
- `scripts/rpi5_deploy_tx.py`

The first five are the current controlled-deploy target sources:

- immutable V10-ownership/runtime-V12 backup core;
- canonical V25 serialized backup wrapper;
- V25 shared-maintenance lock helper;
- dedicated backup cron;
- dedicated backup logrotate policy.

The V25 wrapper/core/lock-helper are **attestation-only** in the controlled-deploy controller. A source difference in one of those paths still means the verified production commit is no longer sufficient to prove alignment, so Phase 6C reports `DEPLOY_REQUIRED`. That classification does **not** mean the generic controller is allowed to overwrite the V25 bundle: live drift must first be handled through its dedicated, separately authorized V25 maintenance path and then re-attested by controlled deploy.

Cron/logrotate remain ordinary managed controlled-deploy targets. The manifest plus four engine files define the controller/source inventory itself.

A changed file outside this reviewed list does not by itself require this controlled-deploy production state to move. A changed file inside this list proves production-impact drift, but never authorizes applying it.

## Classification

`IN_SYNC`
: the resolved verified production SHA equals GitHub `main`.

`MAIN_AHEAD_NO_DEPLOY`
: production is a proven ancestor of `main`, `main` is ahead, and none of the reviewed production-impact paths changed.

`DEPLOY_REQUIRED`
: production is a proven ancestor of `main`, `main` is ahead, and one or more reviewed production-impact paths changed. This is a classification only; the required remediation path may be generic controlled deploy or a dedicated V25 maintenance procedure depending on the impact path.

`DEPLOY_PENDING_AUTH`
: reserved in the shared contract. Phase 6C does **not** emit this state because no separate owner-authorization evidence source exists yet.

`UNKNOWN`
: correlation cannot be proven. Examples include missing verified deploy evidence, GitHub failure/rate limit, short-SHA resolution failure, divergent history, malformed data or missing/incomplete 300-file fallback trees.

Merge authorization is never interpreted as deployment authorization.

## Browser API

`GET /api/deployments`

The route accepts an empty query only and sends `Cache-Control: no-store`.

Browser-visible fields are bounded to:

- fixed project ID/label/repository;
- classification;
- verified production short/full SHA when known;
- GitHub main SHA when known;
- verified deploy timestamp;
- proven ahead count;
- reviewed production-impact flag and exact allowlisted impact paths.

No host path, private deploy metadata, GitHub credential, deployment command or owner-authorization mutation is exposed.

## UI

`/deployments` is a responsive read-only view.

It has no Deploy, Authorize or Rollback action. `DEPLOY_REQUIRED` explicitly states that a separate owner authorization is still required. Activity remains the drill-down for verified deploy events.

## Operational boundary

Phase 6C does not:

- deploy anything;
- create deployment authorization;
- modify the `RPi5_main` deployment controller;
- read root-private deployment state directly from the web/server process;
- create a GitHub credential;
- support private-repository comparison;
- add Cloudflare changes;
- change host/systemd permissions;
- add rollback state or a rollback action.

Production deploy: **NO**.
