# Issue #186 — exact-main production rollout gate

Target production source:

```text
TARGET_SHA=46c47fbd53e6933e2d8db86abdab30edea2badd0
TARGET_TREE=4244c8b5105cad996c87c743b3ba90519a4d092a
EXPECTED_CURRENT_PRODUCTION=a39fc7a9873eedb58cfa49568f9b2e05483cf7c2
GATE_BASE_SHA=5bb54d108bcacf5c0c35f9d34a349929d1ca8029
```

This document and `tools/operator/issue186-exact-main-production-rollout.sh` are source-only. Their merge does not authorize production mutation.

## Why this is an exact-release rollout, not a #167-only restart

The accepted production release is `a39fc7a9...`. Exact target `46c47fbd...` is 16 commits ahead. The production-to-target delta therefore includes the accumulated runtime-relevant P4 work, including #157 runtime/readiness hardening and #167 browser response hardening. The candidate must be built, hashed, smoke-tested and deployed as one immutable exact-SHA release.

The current systemd unit blueprints are not in the accepted-production-to-target changed-file boundary. This rollout must not install/edit units or run `daemon-reload`. Existing services are restarted only after an owner-authorized exact release-pointer activation.

## Why `preflight:host` is not used

`tools/production-host-readiness.mjs` is intentionally a **first-production-bootstrap** verifier. It expects bootstrap conditions such as absent runtime sockets/free port/disabled units. Production is already accepted and running, so invoking that bootstrap verifier for an incremental rollout would be semantically wrong and is intentionally excluded.

The rollout instead performs a live read-only baseline check against the accepted active release and the current broker/agent/web service state.

## 2026-08-22 preflight correction

The first owner-run `--preflight-only` attempt stopped during `LIVE_PRODUCTION_READ_ONLY_BASELINE` before candidate creation or any production mutation. Follow-up read-only evidence showed:

```text
CURRENT=/opt/dashboard_RPi5/releases/a39fc7a9873eedb58cfa49568f9b2e05483cf7c2
broker=active, /proc/<MainPID>/cwd read RC=1 as normal operator
agent=active, /proc/<MainPID>/cwd read RC=1 as normal operator
web=active, /proc/<MainPID>/cwd read RC=1 as normal operator
PRODUCTION_MUTATION=NO
```

The three services intentionally run as separate service identities, so the normal operator cannot read their `/proc/<MainPID>/cwd` links. Exact process-CWD evidence remains required, but the helper now performs only that read through the fixed command `sudo /usr/bin/readlink -f /proc/<MainPID>/cwd`. Failure is converted into an explicit `BLOCKED:` result. This grants no new service, Docker, systemd, terminal, Cloudflare or filesystem write authority.

The correction also tightens post-merge lineage. `5bb54d10...` is pinned as the reviewed #186 gate base and must remain a direct child of target `46c47fbd...` with the original four-file gate boundary. Live GitHub `main` may then be either that exact gate base or exactly one direct corrective child whose diff contains only:

1. `docs/ISSUE186_EXACT_MAIN_PRODUCTION_ROLLOUT.md`;
2. `tools/issue186-exact-main-production-rollout.test.mjs`;
3. `tools/operator/issue186-exact-main-production-rollout.sh`.

Any later or broader GitHub movement fails closed.

## Phase A — owner-run preflight only

After the corrective gate source is merged and exact-main post-merge verification is complete, run as the normal RPi5 operator in an interactive TTY:

```bash
bash tools/operator/issue186-exact-main-production-rollout.sh --preflight-only
```

The helper may request the operator's existing sudo authentication solely for read-only service-CWD evidence. Preflight does not use sudo for a production write.

The helper fails if its immutable run directory already exists. The failed 2026-08-22 baseline attempt stopped before candidate creation, so no candidate run directory was created by that attempt. Any future BLOCKED run after the run directory is created remains a STOP; do not delete/reuse that directory without a new owner decision.

Preflight may write only below:

```text
$HOME/.cache/dashboard-rpi5-operator/issue186-46c47fbd53e6933e2d8db86abdab30edea2badd0
```

It performs:

1. fresh GitHub `main` resolution;
2. fail-closed lineage proof for the pinned gate base and at most one exact corrective child;
3. read-only live production proof that `/opt/dashboard_RPi5/current` is still `a39fc7a9...`;
4. broker, agent and web service Active/MainPID/exact-CWD/stable-NRestarts evidence, with only exact CWD read elevated through `sudo /usr/bin/readlink`;
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

The immediate workflow for this corrective source slice is normal FAST/source governance: exact-head CI -> manual diff/review -> Ready -> STOP before merge.
