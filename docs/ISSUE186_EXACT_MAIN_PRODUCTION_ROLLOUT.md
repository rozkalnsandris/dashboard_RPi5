# Issue #186 — exact-main production rollout gate

Target production source:

```text
TARGET_SHA=46c47fbd53e6933e2d8db86abdab30edea2badd0
TARGET_TREE=4244c8b5105cad996c87c743b3ba90519a4d092a
EXPECTED_CURRENT_PRODUCTION=a39fc7a9873eedb58cfa49568f9b2e05483cf7c2
```

This document and `tools/operator/issue186-exact-main-production-rollout.sh` are source-only. Their merge does not authorize production mutation.

## Why this is an exact-release rollout, not a #167-only restart

The accepted production release is `a39fc7a9...`. Exact target `46c47fbd...` is 16 commits ahead. The production-to-target delta therefore includes the accumulated runtime-relevant P4 work, including #157 runtime/readiness hardening and #167 browser response hardening. The candidate must be built, hashed, smoke-tested and deployed as one immutable exact-SHA release.

The current systemd unit blueprints are not in the accepted-production-to-target changed-file boundary. This rollout must not install/edit units or run `daemon-reload`. Existing services are restarted only after an owner-authorized exact release-pointer activation.

## Why `preflight:host` is not used

`tools/production-host-readiness.mjs` is intentionally a **first-production-bootstrap** verifier. It expects bootstrap conditions such as absent runtime sockets/free port/disabled units. Production is already accepted and running, so invoking that bootstrap verifier for an incremental rollout would be semantically wrong and is intentionally excluded.

The rollout instead performs a live read-only baseline check against the accepted active release and the current broker/agent/web service state.

## Phase A — owner-run preflight only

After this gate source is merged and exact-main post-merge verification is complete, run as the normal RPi5 operator:

```bash
bash tools/operator/issue186-exact-main-production-rollout.sh --preflight-only
```

The helper fails if its immutable run directory already exists. Do not delete/reuse that directory after a BLOCKED run without a new owner decision.

Preflight may write only below:

```text
$HOME/.cache/dashboard-rpi5-operator/issue186-46c47fbd53e6933e2d8db86abdab30edea2badd0
```

It performs:

1. fresh GitHub `main` resolution;
2. fail-closed lineage proof: GitHub main must be either target `46c47fbd...` or exactly one direct child whose diff is only this #186 gate source;
3. read-only live production proof that `/opt/dashboard_RPi5/current` is still `a39fc7a9...`;
4. broker, agent and web service Active/MainPID/exact-CWD/stable-NRestarts evidence;
5. broker/agent Unix-socket health, Docker current-state and web API health/current-Docker checks;
6. main-agent no-`docker`/no-`video` invariant;
7. terminal socket/unit absent/fail-closed invariant;
8. unauthenticated public Access still challenge/deny (`302` or `403`) without changing Cloudflare;
9. fresh immutable candidate checkout of exact target SHA/tree into operator cache;
10. `npm ci --ignore-scripts`, reviewed `node-pty` rebuild, high-severity dependency audit and full `npm run check`;
11. deterministic production candidate manifest generation + exact verification;
12. isolated manifest-only runtime smoke;
13. `production-release-controller.mjs` PLAN only;
14. unchanged live production reproof;
15. immutable `PREFLIGHT_PASS.txt` receipt + SHA-256 and STOP.

Successful output ends with:

```text
PREFLIGHT_RESULT=PASS
PREFLIGHT_RECEIPT_SHA256=<64-hex>
PRODUCTION_MUTATION=NO
NEXT_GATE=EXPLICIT_OWNER_PRODUCTION_ROLLOUT_AUTHORIZATION_BOUND_TO_RECEIPT
```

Any BLOCKED/failure/ambiguity is a STOP. Do not rerun or clean the evidence directory by implication.

## Phase B — separately authorized production rollout

This phase is **not authorized by merge or by successful preflight**.

A future owner authorization must name all of the following:

- issue #186;
- target `46c47fbd53e6933e2d8db86abdab30edea2badd0`;
- expected current production `a39fc7a9873eedb58cfa49568f9b2e05483cf7c2`;
- exact `PREFLIGHT_RECEIPT_SHA256` returned by Phase A;
- release-controller apply/current-pointer mutation;
- production restart order: Docker broker -> agent -> web;
- explicit exclusions: no systemd unit mutation, no permissions/identity change, no Docker authority expansion, no terminal activation, no Cloudflare mutation, no Actions mutation.

Only after such authorization may the already-reviewed helper be invoked:

```bash
bash tools/operator/issue186-exact-main-production-rollout.sh \
  --apply \
  --receipt-sha256 <AUTHORIZED_PREFLIGHT_RECEIPT_SHA256> \
  --ack AUTHORIZE_ISSUE186_EXACT_MAIN_PRODUCTION_ROLLOUT
```

Immediately before the first mutation the helper re-proves:

- GitHub main has not moved since the preflight receipt;
- candidate SHA/tree/manifest still match;
- isolated runtime smoke still passes;
- release-controller PLAN still passes;
- current production remains exactly `a39fc7a9...` and healthy;
- trust-boundary invariants still hold.

Any drift before mutation => STOP with no production write.

## Mutation order after authorization

The first production mutation is the existing reviewed release controller in apply mode. It copies/verifies the immutable release under `/opt/dashboard_RPi5/releases/<sha>` and atomically changes `/opt/dashboard_RPi5/current` using its own exact acknowledgement/lock contract.

Then, and only then:

1. restart `dashboard-rpi5-docker-broker.service`;
2. require broker `/v1/health=200`, Docker containers `=200`, exact target process CWD and stable restart counter;
3. restart `dashboard-rpi5-agent.service`;
4. require agent `/v1/health=200`, exact target CWD and stable restart counter;
5. restart `dashboard-rpi5-web.service`;
6. require loopback `/api/health=200`, `/api/current/docker=200`, exact target CWD and stable restart counter;
7. final trust-boundary acceptance;
8. #167-specific acceptance: CSP present, `X-Content-Type-Options: nosniff`, `/api/health` `Cache-Control: no-store`;
9. public unauthenticated Access remains challenge/deny;
10. terminal remains absent and main agent remains outside `docker`/`video` groups.

## Failure rule after mutation begins

After the release-controller apply starts, any error or ambiguity is evidence + **STOP**.

The helper intentionally contains no automatic:

- retry;
- rollback;
- cleanup;
- extra restart;
- unit edit/install/enable/disable/daemon-reload;
- permission/group change;
- Cloudflare action;
- terminal activation;
- alternate mutation path.

A rollback, if ever needed, requires a new explicit owner authorization and fresh evidence.

## Authorization state

```text
MERGE_AUTHORIZATION=NONE
PRODUCTION_MUTATION_AUTHORIZATION=NONE
CLOUDFLARE_MUTATION_AUTHORIZATION=NONE
ACTIONS_RERUN_CANCEL_AUTHORIZATION=NONE
```

The immediate workflow for this source slice is normal FAST/source governance: exact-head CI -> manual diff/review -> Ready -> STOP before merge.
