# Issue #186 — exact-main production rollout gate

Target production source:

```text
TARGET_SHA=46c47fbd53e6933e2d8db86abdab30edea2badd0
TARGET_TREE=4244c8b5105cad996c87c743b3ba90519a4d092a
EXPECTED_CURRENT_PRODUCTION=a39fc7a9873eedb58cfa49568f9b2e05483cf7c2
GATE_BASE_SHA=5bb54d108bcacf5c0c35f9d34a349929d1ca8029
PROCESS_EVIDENCE_FIX_SHA=d65da90a567f3eed6a0d515493dadbe3ef056eb8
TRUST_CHAIN_FIX_SHA=0bd658524df93f28a2302c1a12327b47b3f31f21
NATIVE_BUILD_FIX_SHA=5a8bc0372ce0c20e310f75a41564553dcbf62bef
CONTROLLER_CWD_FIX_SHA=4a6931a523672e6607ebf88b58b6ba66cccc1bd3
```

This document and `tools/operator/issue186-exact-main-production-rollout.sh` are source-only. Their merge does not authorize production mutation.

## Why this is an exact-release rollout, not a #167-only restart

The accepted production release is `a39fc7a9...`. Exact target `46c47fbd...` is 16 commits ahead. The production-to-target delta therefore includes the accumulated runtime-relevant P4 work, including #157 runtime/readiness hardening and #167 browser response hardening. The candidate must be built, hashed, smoke-tested and deployed as one immutable exact-SHA release.

The current systemd unit blueprints are not in the accepted-production-to-target changed-file boundary. This rollout must not install/edit units or run `daemon-reload`. Existing services are restarted only after an owner-authorized exact release-pointer activation.

## Why `preflight:host` is not used

`tools/production-host-readiness.mjs` is intentionally a **first-production-bootstrap** verifier. It expects bootstrap conditions such as absent runtime sockets/free port/disabled units. Production is already accepted and running, so invoking that bootstrap verifier for an incremental rollout would be semantically wrong and is intentionally excluded.

The rollout instead performs a live read-only baseline check against the accepted active release and the current broker/agent/web service state.

## 2026-08-22 correction 1 — service process CWD evidence

The first owner-run `--preflight-only` attempt stopped during `LIVE_PRODUCTION_READ_ONLY_BASELINE` before candidate creation or any production mutation. Follow-up read-only evidence showed:

```text
CURRENT=/opt/dashboard_RPi5/releases/a39fc7a9873eedb58cfa49568f9b2e05483cf7c2
broker=active, /proc/<MainPID>/cwd read RC=1 as normal operator
agent=active, /proc/<MainPID>/cwd read RC=1 as normal operator
web=active, /proc/<MainPID>/cwd read RC=1 as normal operator
PRODUCTION_MUTATION=NO
```

The three services intentionally run as separate service identities, so the normal operator cannot read their `/proc/<MainPID>/cwd` links. Exact process-CWD evidence remains required, but the helper performs only that read through the fixed command `sudo /usr/bin/readlink -f /proc/<MainPID>/cwd`. Failure is converted into an explicit `BLOCKED:` result. This grants no new service, Docker, systemd, terminal, Cloudflare or filesystem write authority.

That correction was squash-merged as `d65da90a567f3eed6a0d515493dadbe3ef056eb8`.

## 2026-08-22 correction 2 — operator must not become a broker/agent socket client

The second separately authorized `--preflight-only` run used the immutable helper from `d65da90a...` and again stopped during the live baseline:

```text
HELPER_BLOB=86b8e3a4c9cb743bff36716d83e38cf21d40e2a1
GITHUB_MAIN_SHA=d65da90a567f3eed6a0d515493dadbe3ef056eb8
STAGE=LIVE_PRODUCTION_READ_ONLY_BASELINE
BLOCKED: broker socket missing
PREFLIGHT_EXIT_CODE=1
PRODUCTION_MUTATION=NO
```

This was not evidence that the active broker service was unhealthy. The canonical unit intentionally creates `/run/dashboard-rpi5-docker-broker` as a `0750` runtime directory for the broker/client trust boundary. Only `dashboard-rpi5-agent` receives the dedicated broker-client group. The normal operator is intentionally not a broker client. The same principle applies to the agent Unix socket: the web service is the intended client, not the human operator.

Therefore the preflight must not probe either runtime socket directly, and it must not repair the situation by granting the operator `dashboard-rpi5-docker-client`, agent-client or `docker` membership or by widening runtime-directory/socket permissions.

The existing product path already supplies a stronger end-to-end proof without authority expansion:

```text
operator
  -> loopback web /api/current/docker
  -> server agent-current-state client
  -> agent /v1/docker/containers
  -> createDockerBrokerTransport()
  -> bounded Docker broker
  -> Docker Engine
```

`/api/current/host=200` separately proves the web-to-agent current-state path. `/api/current/docker=200` proves the full web-to-agent-to-broker-to-Docker path. The helper uses those loopback web endpoints for both preflight and post-restart acceptance and contains no direct operator `curl --unix-socket` probe.

The first two BLOCKED runs stopped before `build_candidate_once`, so neither created the original target-keyed candidate run directory. Their external helper/download evidence remains preserved; no cleanup or reuse is implied.

That trust-chain correction was squash-merged as `0bd658524df93f28a2302c1a12327b47b3f31f21`.

## 2026-08-22 correction 3 — npm 11 native source rebuild and immutable rerun namespace

The next owner-run preflight used the immutable helper from `0bd6585...` on the RPi5. The live production baseline passed and the helper entered candidate validation. `npm ci --ignore-scripts` completed, then npm 11 rejected the helper's `npm rebuild node-pty --build-from-source` invocation before the native rebuild could run:

```text
STAGE=EXACT_GITHUB_TARGET
GITHUB_MAIN_SHA=0bd658524df93f28a2302c1a12327b47b3f31f21
STAGE=LIVE_PRODUCTION_READ_ONLY_BASELINE
STAGE=EXACT_CANDIDATE_BUILD_AND_VALIDATION
npm error code EUNKNOWNCONFIG
npm error Unknown cli flag:
npm error   - --build-from-source
```

No production apply/restart path was entered. The failure happened in the operator-owned candidate build workspace and production mutation remained absent.

`node-pty@1.1.0` itself supports a source-build request through `npm_config_build_from_source=true`. The helper therefore retained the source-build request using that environment contract instead of the unsupported npm CLI flag.

The failed RPi5 attempt had already created the original immutable run directory:

```text
$HOME/.cache/dashboard-rpi5-operator/issue186-46c47fbd53e6933e2d8db86abdab30edea2badd0
```

That evidence must not be deleted, cleaned or reused. A future separately authorized preflight after this corrective source is merged uses a new sibling namespace bound to the freshly resolved gate main:

```text
$HOME/.cache/dashboard-rpi5-operator/issue186-46c47fbd53e6933e2d8db86abdab30edea2badd0-gate-<GATE_MAIN_SHA>
```

The helper still fails closed if that exact new run directory already exists. It contains no automatic cleanup path.

The `1 low severity vulnerability` reported by `npm ci` was not the observed blocker. The rollout retains the existing explicit `npm audit --audit-level=high` gate after the native rebuild.

That correction was squash-merged as `5a8bc0372ce0c20e310f75a41564553dcbf62bef`.

## 2026-08-22 correction 4 — candidate cwd for release-controller and explicit native-build proof

The next separately authorized RPi5 preflight used exact merged main `5a8bc037...`. It passed the live production baseline, dependency install, complete source check, deterministic candidate manifest and isolated runtime smoke. It then stopped before unchanged-production reproof and before receipt creation:

```text
GITHUB_MAIN_SHA=5a8bc0372ce0c20e310f75a41564553dcbf62bef
STAGE=LIVE_PRODUCTION_READ_ONLY_BASELINE
STAGE=EXACT_CANDIDATE_BUILD_AND_VALIDATION
...
{"status":"PASS","sourceSha":"46c47fbd53e6933e2d8db86abdab30edea2badd0","candidateSha256":"b1f1029d01f5eb4f50b6c2453fa87c07f71aceca49e31afbf2b5deed4a44dcb9"}
{"status":"PASS","sourceSha":"46c47fbd53e6933e2d8db86abdab30edea2badd0","candidateSha256":"b1f1029d01f5eb4f50b6c2453fa87c07f71aceca49e31afbf2b5deed4a44dcb9","terminal":"disabled"}
{"status":"BLOCKED","error":"ENOENT: no such file or directory, lstat '/home/andris/ops/production/release-activation-contract.json'"}
```

`tools/production-release-controller.mjs` intentionally resolves `ops/production/release-activation-contract.json` relative to `process.cwd()`. The #186 helper invoked the controller using an absolute script path but did not change cwd, so an interactive invocation from `/home/andris` caused the controller to look for `/home/andris/ops/...` instead of the immutable candidate contract.

The correction keeps the release controller unchanged and binds every controller invocation to the immutable candidate repository root:

- preflight PLAN runs after `cd "$CANDIDATE_ROOT"`;
- production prewrite PLAN revalidation uses the same helper;
- the separately owner-gated `sudo /usr/bin/node ... --apply` path also runs from `CANDIDATE_ROOT` before the first release-controller mutation.

This is necessary for both correctness and fail-closed safety: fixing only the preflight PLAN would leave the later production apply vulnerable to the same cwd mismatch after `PRODUCTION_MUTATION_BEGIN`.

The same RPi5 run also emitted:

```text
npm warn Unknown env config "build-from-source".
npm warn rebuild 3 packages had install scripts blocked because they are not covered by allowScripts.
rebuilt dependencies successfully
```

Therefore a zero exit from the earlier `npm rebuild node-pty` form is not sufficient proof that node-pty's native lifecycle build actually ran. npm 11 blocks unapproved dependency install scripts by default. The corrected helper remains narrow:

```bash
npm --prefix "$CANDIDATE_ROOT" ci --ignore-scripts
npm_config_build_from_source=true \
  npm --prefix "$CANDIDATE_ROOT" rebuild node-pty --dangerously-allow-all-scripts
```

`npm rebuild` is still package-spec limited to `node-pty`; the broad-script override applies only inside that explicit rebuild operation and is not used for `npm ci` or the rest of the candidate tree. The helper then fails closed unless Linux source output `node_modules/node-pty/build/Release/pty.node` exists and `import("node-pty")` exposes `spawn`. This converts the native-build requirement from intent into direct artifact/load evidence.

The failed `5a8bc037...` gate-main run directory is immutable evidence and must not be deleted or reused:

```text
$HOME/.cache/dashboard-rpi5-operator/issue186-46c47fbd53e6933e2d8db86abdab30edea2badd0-gate-5a8bc0372ce0c20e310f75a41564553dcbf62bef
```

A future separately authorized run after this correction is merged selects a different sibling because `GATE_MAIN_SHA` changes.

That correction was squash-merged as `4a6931a523672e6607ebf88b58b6ba66cccc1bd3`.

## 2026-08-22 correction 5 — root-only installed manifest evidence for PLAN

The next separately authorized RPi5 preflight used exact merged main `4a6931a...`. It passed the live production baseline, the explicit native `node-pty` build proof, the complete source check, deterministic candidate manifest and isolated runtime smoke. The candidate-cwd correction also worked: the release controller reached the live production release instead of resolving against `/home/andris`. PLAN then stopped before unchanged-production reproof and before receipt creation:

```text
GITHUB_MAIN_SHA=4a6931a523672e6607ebf88b58b6ba66cccc1bd3
STAGE=LIVE_PRODUCTION_READ_ONLY_BASELINE
STAGE=EXACT_CANDIDATE_BUILD_AND_VALIDATION
...
{"status":"PASS","sourceSha":"46c47fbd53e6933e2d8db86abdab30edea2badd0","candidateSha256":"b1f1029d01f5eb4f50b6c2453fa87c07f71aceca49e31afbf2b5deed4a44dcb9"}
{"status":"PASS","sourceSha":"46c47fbd53e6933e2d8db86abdab30edea2badd0","candidateSha256":"b1f1029d01f5eb4f50b6c2453fa87c07f71aceca49e31afbf2b5deed4a44dcb9","terminal":"disabled"}
{"status":"BLOCKED","error":"EACCES: permission denied, open '/opt/dashboard_RPi5/releases/a39fc7a9873eedb58cfa49568f9b2e05483cf7c2/.dashboard-production-candidate.json'"}
```

This was not production drift. The reviewed release-activation contract intentionally makes `.dashboard-production-candidate.json` `root:root` mode `0600`, while regular release files remain `0644`. The controller PLAN intentionally verifies the observed current installed release by reading that marker and hashing the installed allowlisted files before it reports an activation plan. A normal operator therefore cannot complete that exact installed-release verification without read privilege for the marker.

The correction does **not** weaken marker permissions, add ACLs/groups, copy the marker into a less-protected host location, or grant the operator general release-root authority. Instead, the already-reviewed exact-target controller PLAN runs from the immutable candidate cwd through the fixed executable `sudo /usr/bin/node`. The PLAN invocation supplies only `--candidate-root`, `--manifest` and `--sha`; it contains no `--apply`, no acknowledgement and no expected-current mutation gate. Its JSON output is redirected to the operator-owned immutable run directory and must report `"status":"PLAN"` or the helper fails closed.

The target controller's existing tests already prove that PLAN validates an exact candidate without writing the activation root and remains non-mutating under a restrictive caller umask. Full `npm run check` remains mandatory before the privileged PLAN invocation. The separately authorized apply path remains a different helper and still requires the receipt hash, exact owner acknowledgement and prewrite revalidation.

The failed `4a6931a...` gate-main run directory is immutable evidence and must not be deleted or reused:

```text
$HOME/.cache/dashboard-rpi5-operator/issue186-46c47fbd53e6933e2d8db86abdab30edea2badd0-gate-4a6931a523672e6607ebf88b58b6ba66cccc1bd3
```

A future separately authorized run after this correction is merged selects a new gate-main-keyed sibling. No cleanup of any earlier failed directory is required.

## Corrective lineage contract

The rollout gate is pinned as a short reviewed chain:

1. target `46c47fbd...`;
2. gate base `5bb54d10...`, exactly one direct child with the original four-file #186 gate boundary;
3. process-evidence correction `d65da90a...`, exactly one direct child with only:
   - `docs/ISSUE186_EXACT_MAIN_PRODUCTION_ROLLOUT.md`;
   - `tools/issue186-exact-main-production-rollout.test.mjs`;
   - `tools/operator/issue186-exact-main-production-rollout.sh`;
4. trust-chain correction `0bd6585...`, exactly one direct child of `d65da90a...` with the same three-file boundary;
5. native-build/evidence-namespace correction `5a8bc037...`, exactly one direct child of `0bd6585...` with that same three-file boundary;
6. controller-cwd/native-proof correction `4a6931a...`, exactly one direct child of `5a8bc037...` with that same three-file boundary;
7. live GitHub `main` may then be either exact `4a6931a...` or exactly one direct read-only PLAN privilege corrective child with that same three-file boundary.

Any later or broader GitHub movement fails closed. This does not make arbitrary future `main` a valid production target: runtime target remains immutable `46c47fbd...`.

## Phase A — owner-run preflight only

After the current corrective gate source is merged and exact-main post-merge verification is complete, run as the normal RPi5 operator in an interactive TTY:

```bash
bash tools/operator/issue186-exact-main-production-rollout.sh --preflight-only
```

The helper may request the operator's existing sudo authentication only for two reviewed read-only evidence paths: fixed `/usr/bin/readlink` reads of service `/proc/<MainPID>/cwd`, and the exact-target release-controller PLAN through fixed `/usr/bin/node` so it can verify the root-only installed manifest marker. Preflight never passes `--apply` or an activation acknowledgement to that controller, does not use sudo for a production write, and does not require direct broker/agent socket authority.

The helper resolves fresh GitHub `main` first, then selects an immutable gate-main-keyed run directory. It fails if that exact run directory already exists. Any future BLOCKED run after that run directory is created remains a STOP; do not delete/reuse it without a new owner decision.

Preflight may write only below the newly selected operator-cache sibling:

```text
$HOME/.cache/dashboard-rpi5-operator/issue186-46c47fbd53e6933e2d8db86abdab30edea2badd0-gate-<GATE_MAIN_SHA>
```

All earlier failed run directories are preserved untouched.

Preflight performs:

1. fresh GitHub `main` resolution;
2. fail-closed proof of target -> gate base -> process-evidence fix -> trust-chain fix -> native-build fix -> controller-cwd fix -> at most one exact read-only PLAN privilege corrective child;
3. read-only proof that `/opt/dashboard_RPi5/current` is still `a39fc7a9...`;
4. broker, agent and web service Active/MainPID/exact-CWD/stable-NRestarts evidence, with only exact CWD reads elevated through fixed `sudo /usr/bin/readlink`;
5. loopback `/api/health=200`;
6. loopback `/api/current/host=200` as web-to-agent evidence;
7. loopback `/api/current/docker=200` as end-to-end web-to-agent-to-broker-to-Docker evidence;
8. main-agent no-`docker`/no-`video` invariant;
9. terminal socket/unit absent/fail-closed invariant;
10. unauthenticated public Access still challenge/deny (`302` or `403`) without changing Cloudflare;
11. fresh immutable candidate checkout of exact target SHA/tree into the new operator-cache run directory;
12. `npm ci --ignore-scripts`, a package-spec-limited forced `node-pty` lifecycle rebuild, direct `build/Release/pty.node` existence + module-load proof, high-severity dependency audit and full `npm run check`;
13. deterministic production candidate manifest generation + exact verification;
14. isolated manifest-only runtime smoke;
15. exact-target `production-release-controller.mjs` PLAN from exact candidate cwd through fixed `sudo /usr/bin/node`, with no `--apply`, no acknowledgement and no expected-current mutation argument; require JSON `status=PLAN`;
16. unchanged live production reproof through the same least-privilege chain;
17. immutable `PREFLIGHT_PASS.txt` receipt + SHA-256 and STOP.

Successful output ends with:

```text
PREFLIGHT_RESULT=PASS
PREFLIGHT_RECEIPT_SHA256=<64-hex>
PRODUCTION_MUTATION=NO
NEXT_GATE=EXPLICIT_OWNER_PRODUCTION_ROLLOUT_AUTHORIZATION_BOUND_TO_RECEIPT
```

Any BLOCKED/failure/ambiguity is a STOP. Do not rerun or clean any evidence directory by implication.

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
- release-controller PLAN still passes from candidate cwd through the same fixed read-only privileged PLAN helper;
- current production remains exactly `a39fc7a9...` and healthy through the loopback web trust chain;
- trust-boundary invariants still hold.

Any drift before mutation => STOP with no production write.

## Mutation order after authorization

The first production mutation is the existing reviewed release controller in apply mode, invoked from the immutable candidate cwd. It copies/verifies the immutable release under `/opt/dashboard_RPi5/releases/<sha>` and atomically changes `/opt/dashboard_RPi5/current` using its own exact acknowledgement/lock contract.

Then, and only then:

1. restart `dashboard-rpi5-docker-broker.service`;
2. require broker exact target process CWD and stable restart counter, then require loopback `/api/current/docker=200` through the still-running web/agent chain to prove the restarted broker and Docker Engine are reachable;
3. restart `dashboard-rpi5-agent.service`;
4. require agent exact target CWD and stable restart counter, then require `/api/current/host=200` and `/api/current/docker=200` through the still-running web service;
5. restart `dashboard-rpi5-web.service`;
6. require exact target web CWD/stable restart counter plus loopback `/api/health=200`, `/api/current/host=200` and `/api/current/docker=200`;
7. final trust-boundary acceptance through the same loopback chain;
8. #167-specific acceptance: CSP present, `X-Content-Type-Options: nosniff`, `/api/health` `Cache-Control: no-store`;
9. public unauthenticated Access remains challenge/deny;
10. terminal remains absent and main agent remains outside `docker`/`video` groups.

The operator never gains direct broker or agent socket authority as part of this rollout.

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
PREFLIGHT_RERUN_AUTHORIZATION=NONE
PRODUCTION_MUTATION_AUTHORIZATION=NONE
CLOUDFLARE_MUTATION_AUTHORIZATION=NONE
ACTIONS_RERUN_CANCEL_AUTHORIZATION=NONE
```

The immediate workflow for this corrective source slice is normal FAST/source governance: exact-head CI -> manual diff/review -> Ready -> STOP before merge.
