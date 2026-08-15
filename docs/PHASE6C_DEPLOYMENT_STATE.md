# Phase 6C — deployment state

Status: source-only implementation. Production deploy: **NO**.

## Purpose

Phase 6C shows whether the controlled `rozkalnsandris/RPi5_main` production state is aligned with GitHub `main` without introducing a deployment write path.

The page is evidence correlation, not a deployment controller.

## Production evidence

Production commit evidence comes only from the existing local agent operation:

`GET /v1/deploy/events/recent`

That operation accepts only root-authenticated journald entries emitted by the V12 controlled deploy engine after a successful final verification:

`DEPLOY PASS transaction=<txid> commit=<12hex>`

The V12 source fixes `EXPECTED_REPOSITORY` to `rozkalnsandris/RPi5_main`, and transaction metadata records the same repository. Therefore the successful marker is scoped to that repository rather than being treated as a generic host deploy marker.

Phase 6C does **not** read `/var/lib/rpi5-deploy`, `/var/log/rpi5-deploy.log`, private transaction JSON, rollback metadata, or any root-only file.

## GitHub evidence

The server has one purpose-built public REST client for exactly:

`rozkalnsandris/RPi5_main`

The browser cannot choose the repository, branch, ref, compare range or URL.

The client performs only fixed GET requests for:

1. branch `main`;
2. the 12-character verified production commit, which must resolve to a full 40-character SHA with the same prefix;
3. when required, `productionFull...mainFull` comparison.

No GitHub App token, PAT, cookie or `Authorization` header is supported in Phase 6C. The repository is public. GitHub documents a 60 requests/hour limit for unauthenticated REST use, so successful correlation results are cached server-side for five minutes. A normal dashboard refresh therefore does not become GitHub polling.

Each request has a three-second timeout, redirects are rejected and the decoded response is capped at 2 MiB.

## Compare completeness

GitHub documents that compare responses expose at most 300 changed files. The production-impact decision must not silently rely on a potentially truncated list.

Therefore a response containing **300 files** is treated as incomplete and fails closed. It becomes `UNKNOWN`; it is never treated as `MAIN_AHEAD_NO_DEPLOY`.

Renames are checked by considering both `filename` and `previous_filename`.

## Reviewed production-impact policy

The current exact path allowlist is:

- `ops/bin/rpi5-backup`
- `ops/cron.d/rpi5-backup`
- `ops/logrotate.d/rpi5-backup`
- `ops/deploy/targets.json`
- `scripts/rpi5-deploy`
- `scripts/rpi5_deploy.py`
- `scripts/rpi5_deploy_lib.py`
- `scripts/rpi5_deploy_tx.py`

The first three are current controlled-deploy target sources from `ops/deploy/targets.json`. The manifest plus four deploy-engine files are the controlled deployment engine/source inventory.

A changed file outside this reviewed list does not by itself require a V12 host deployment. A changed file inside this list proves production-impact drift, but does not authorize applying it.

## Classification

`IN_SYNC`
: the resolved verified production SHA equals GitHub `main`.

`MAIN_AHEAD_NO_DEPLOY`
: production is a proven ancestor of `main`, `main` is ahead, and none of the reviewed production-impact paths changed.

`DEPLOY_REQUIRED`
: production is a proven ancestor of `main`, `main` is ahead, and one or more reviewed production-impact paths changed.

`DEPLOY_PENDING_AUTH`
: reserved in the shared contract. Phase 6C does **not** emit this state because no separate owner-authorization evidence source exists yet.

`UNKNOWN`
: correlation cannot be proven. Examples include missing verified deploy evidence, GitHub failure/rate limit, short-SHA resolution failure, divergent history, malformed data or a 300-file comparison boundary.

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

`/deployments` replaces the Phase 1 placeholder with a responsive read-only view.

It has no Deploy, Authorize or Rollback action. `DEPLOY_REQUIRED` explicitly states that a separate owner authorization is still required. Activity remains the drill-down for verified deploy events.

## Operational boundary

Phase 6C does not:

- deploy anything;
- create deployment authorization;
- modify the V12 deployment controller;
- read root-private deployment state directly;
- create a GitHub credential;
- support private-repository comparison;
- add Cloudflare changes;
- change host/systemd permissions;
- add rollback state or a rollback action.

Production deploy: **NO**.
