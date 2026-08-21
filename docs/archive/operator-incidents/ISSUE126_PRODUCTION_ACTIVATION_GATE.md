# Issue #126 production activation gate

## Purpose

Stage one exact, owner-gated production activation path for the already prepared and verified P3 bounded Docker recent-events candidate. This PR is source-only; merge and production activation remain separate owner gates.

## Exact base and prepared candidate

```text
ACTIVATION_PR=173
BASE_MAIN=f87f803e13ec50ec5909b27dc160da7e66621af3
BASE_TREE=401d3cc7ca5f0b81417cac548a5af72f02da5485
TARGET=a39fc7a9873eedb58cfa49568f9b2e05483cf7c2
TARGET_TREE=bd2fa68711b1cf4617088a18c524e3c60d427152
SOURCE_PR=160
SOURCE_HEAD=a44e95b4b480e29b8d537130903869c00fc3ef0d
SOURCE_CI=368
SOURCE_CI_RUN_ID=32407296336
CANDIDATE_SHA256=eb3f406f798ad391ab692e81253c0f70dae1acb05ac7b62a6640cfff494818b0
MANIFEST_SHA256=ce995eaebe239cf97364d3ef2a5f15516461e9780b591b02c609847e55674821
FILES=61
BYTES=6543699
```

The candidate lives only in the owner R3 isolated workspace:

```text
/home/andris/.cache/dashboard-rpi5-operator/issue126-f87f803e13ec50ec5909b27dc160da7e66621af3-r3/home/.cache/dashboard-rpi5-candidate-prep/a39fc7a9873eedb58cfa49568f9b2e05483cf7c2-issue126
```

The historical global incomplete workspace remains evidence and is never reused, renamed, cleaned or deleted by this activation helper.

## Accepted production before activation

```text
CURRENT_RELEASE=4295c23de5634dcb86b5fe9f57be92416eb9a75b
host=200
docker=200
logs=200
quick=200
events=503
terminal=absent
access=302
```

The R3 preparation receipt proved candidate manifest verification, runtime smoke and release-controller PLAN, while production remained unchanged. One Bash null-byte warning was retained as source-hardening evidence; it did not prevent the full R3 PASS. This activation helper uses status-only HTTP probes for the binary-risk event checks and does not rely on that warning path.

## Post-merge source gate

`tools/operator/issue126-production-activation.sh` may run only after PR #173 is merged. It fails closed unless:

1. immutable base `f87f803e...` exists with exact tree and verified signature;
2. PR #173 is closed/merged from that exact base;
3. live `main` equals the PR #173 squash merge;
4. live main has exactly one parent equal to the base;
5. base -> live main is exactly one squash commit with the exact four-file boundary:
   - `docs/ISSUE126_PRODUCTION_ACTIVATION_GATE.md`;
   - `package.json`;
   - `tools/issue126-production-activation.test.mjs`;
   - `tools/operator/issue126-production-activation.sh`;
6. a natural exact-head successful PR #173 CI exists with `check`, `terminal-native (x64)` and `terminal-native (arm64)` successful;
7. immutable PR #160 target/tree/head/CI evidence remains exact.

Any later main movement blocks the helper.

## Candidate reproof

Before touching production the helper re-proves from the fixed R3 workspace:

- exact repository HEAD/tree;
- exact manifest SHA-256;
- exact candidate SHA-256, file count and bytes;
- `production-candidate-manifest.mjs --verify` PASS;
- `production-runtime-smoke.mjs` PASS;
- release-controller PLAN observes exactly current release `4295c23d...` and target release absent.

No arbitrary candidate path, source SHA, service name or release target is accepted from the operator.

## Production preflight and race gate

The helper has a non-mutating `--preflight-only` mode and an exact owner-ack activation mode. Before mutation it requires:

- normal operator `andris` on Raspberry Pi 5, Node 24;
- current pointer exactly `releases/4295c23d...`;
- target release absent and release-controller lock absent;
- installed broker/agent/web units byte-equal to the target candidate unit sources, therefore no `daemon-reload` or unit mutation is needed;
- broker, agent and web active with stable PID/NRestarts and cwd on the current release;
- Docker socket, broker socket and agent socket metadata exact;
- main agent persistent/runtime Docker/video authority absent while broker retains runtime Docker authority;
- broker current-state/logs PASS and recent-events route still 404;
- agent host/Docker/logs/Quick Commands PASS and recent events still 503;
- web health/current-state/Quick Commands PASS;
- terminal socket absent;
- Cloudflare Access still returns the expected 302 challenge.

Immediately before the first mutation the helper repeats main/current/PID/NRestarts/target/lock/candidate checks. Drift => STOP with authorization unconsumed.

## Exact mutation order

After a separately explicit owner production authorization using the exact acknowledgement, the first mutation consumes that authorization. The only mutation sequence is:

1. existing `production-release-controller.mjs --apply` with exact candidate, exact expected current and its built-in release acknowledgement;
2. restart `dashboard-rpi5-docker-broker.service` exactly once;
3. bounded application-level broker readiness, then prove current-state/logs/events=200 and forbidden generic events path remains 404;
4. restart `dashboard-rpi5-agent.service` exactly once;
5. bounded application-level agent readiness, then prove host/Docker/logs/Quick Commands/events=200 and Docker/video runtime groups remain absent;
6. restart `dashboard-rpi5-web.service` exactly once;
7. bounded application-level web readiness, then prove health/current-state/Quick Commands/Activity=200;
8. final exact-target cwd/current-pointer/NRestarts/events/Activity/terminal/Access acceptance;
9. STOP.

There is no automatic retry, rollback or cleanup. If anything fails or becomes ambiguous after mutation starts, preserve evidence and STOP for a new owner decision.

## Explicitly absent

The helper contains no:

- `daemon-reload`, unit install/edit/enable/disable;
- identity/group creation or membership mutation;
- permission widening or ACL mutation;
- generic Docker proxy or Docker mutation path;
- terminal/PTTY activation;
- Cloudflare mutation;
- GitHub Actions rerun/cancel;
- alternate release path;
- automatic retry, rollback or cleanup.

The existing release controller does normalize the new release tree to its already-reviewed root:root/mode contract while applying the exact manifest; this is part of the existing release apply, not a permission-widening path.

## Authorization state

```text
R3_PREP_AUTHORIZATION=CONSUMED
PR173_MERGE_AUTHORIZATION=NONE
PRODUCTION_MUTATION_AUTHORIZATION=NONE
ACTIONS_RERUN_AUTHORIZATION=NONE
OLD_WORKSPACE_CLEANUP_AUTHORIZATION=NONE
```

After exact-head CI and final review pass, PR #173 may become Ready and must STOP for an explicit owner merge command. Merge authorization will still not authorize production activation.
