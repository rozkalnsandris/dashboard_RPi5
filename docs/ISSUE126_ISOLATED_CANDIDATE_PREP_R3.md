# Issue #126 isolated candidate-prep R3

## Purpose

Preserve the historical incomplete candidate-preparation workspace as evidence and provide a new one-shot preparation wrapper that can safely cross the PR #172 post-merge boundary without deleting, reusing, renaming, or otherwise mutating that workspace.

This is source-only preparation. It does not authorize production activation, release apply, service restart, systemd/identity/permission changes, Docker authority changes, Cloudflare changes, terminal activation, GitHub Actions reruns, or cleanup of prior evidence.

## Immutable candidate and base evidence

The Docker-events production candidate remains the exact PR #160 source:

```text
candidate_target=a39fc7a9873eedb58cfa49568f9b2e05483cf7c2
candidate_tree=bd2fa68711b1cf4617088a18c524e3c60d427152
source_ci=368
```

PR #170 was squash-merged as the immutable helper/base source for R3:

```text
base_main=db6c4383b33dd9902094c54afd60e51a161f8f4c
base_tree=1a457416331357c54e9dae278769a4ef3690bd7c
merged_helper_blob=3541750f511289056c4a4b8d684db139b9c903eb
```

The source helper at that blob remains unchanged in GitHub. R3 downloads and verifies that immutable helper before creating an ephemeral, deterministic preparation-only copy inside the one-shot operator run root.

## R2 stop receipt

The R2 owner-run wrapper passed its immutable GitHub gate and the PR170 helper passed the read-only production preflight. It then failed closed at `fresh-workspace` because the historical global candidate workspace already existed.

The receipt explicitly reported no production mutation, release apply, systemd/identity/permission mutation, Cloudflare mutation, service restart, Actions mutation, retry, or cleanup.

## Historical workspace classification

Read-only inspection classified:

```text
workspace=/home/andris/.cache/dashboard-rpi5-candidate-prep/a39fc7a9873eedb58cfa49568f9b2e05483cf7c2-issue126
owner=andris:andris
mode=700
size≈408M
repo_HEAD=a39fc7a9873eedb58cfa49568f9b2e05483cf7c2
repo_tree=bd2fa68711b1cf4617088a18c524e3c60d427152
repo_origin=https://github.com/rozkalnsandris/dashboard_RPi5.git
node_modules≈405M
production-candidate.json=ABSENT
```

Checkout/dependency/build activity is present, but the manifest is absent. Therefore this directory is retained as historical partial-preparation evidence, not accepted as a completed/proven production candidate.

R3 does not delete, reuse, rename, or clean this workspace.

## Why isolated HOME alone was insufficient

An earlier #172 source draft used the immutable PR170 helper unchanged with only an isolated `HOME`. That avoided the stale workspace collision, but it contained a deterministic post-merge lineage trap: the PR170 helper itself requires its observed `main` to be the PR170 squash merge. After PR #172 is merged, live `main` is the PR172 squash merge, so that unchanged child helper would block at its GitHub source gate before candidate workspace creation.

R3 therefore separates two proofs:

1. the outer PR172 wrapper proves the actual live post-merge state;
2. the ephemeral child copy preserves and verifies the historical PR170 helper lineage against immutable `db6c4383...`.

## R3 post-merge source gate

`tools/operator/issue126-production-candidate-prep-isolated-wrapper.sh` requires after PR #172 is merged:

1. immutable base `db6c4383...` exists with tree `1a457416...` and verified signature;
2. PR #172 is closed/merged with exact base `db6c4383...`;
3. PR #172 merge commit is exactly live GitHub `main`;
4. live main has a verified signature, exactly one parent, and parent `db6c4383...`;
5. compare `db6c4383... -> live main` is exactly one squash commit, not behind, and has exactly one commit total;
6. the changed-file boundary is exactly:
   - `docs/ISSUE126_ISOLATED_CANDIDATE_PREP_R3.md`;
   - `package.json`;
   - `tools/issue126-production-candidate-prep-isolated-wrapper.test.mjs`;
   - `tools/operator/issue126-production-candidate-prep-isolated-wrapper.sh`;
7. natural exact-head PR #172 CI is completed/success and includes `check`, `terminal-native (x64)`, and `terminal-native (arm64)`;
8. the helper is fetched only from immutable base `db6c4383...` and must retain Git blob `3541750f...`.

Any later `main` commit fails closed. The wrapper rechecks live main immediately before helper execution and again after successful preparation.

## Deterministic ephemeral helper transform

Inside the one-shot operator run root only, R3 transforms the verified PR170 helper with bounded textual substitutions:

- inserts `REBIND_MERGE=db6c4383...`;
- retains the actual live-main response as `live_main_sha`, while historical PR170 lineage checks use `main_sha=$REBIND_MERGE`;
- replaces the old broker-events 404 body capture with a status-only Unix-socket `curl` using `-o /dev/null -w "%{http_code}"`;
- verifies each transform occurs exactly once;
- verifies the old binary-body command substitution is absent;
- requires `bash -n` to pass before execution.

This fixes the PR172 post-merge lineage trap without modifying the immutable PR170 helper in GitHub and removes the observed NUL-byte warning path from the ephemeral child helper.

## R3 isolation and one-shot model

After the source gate passes, R3:

1. requires normal operator `andris` on Raspberry Pi 5 Model B;
2. creates one run root keyed to the actual PR172 squash merge SHA;
3. fails closed if that run root already exists;
4. creates a fresh isolated `HOME` below that run root;
5. records metadata for the historical global workspace before execution;
6. runs the deterministically patched preparation-only helper once with the isolated `HOME`;
7. captures complete helper output in the run root;
8. on any BLOCKED/failure, preserves the run root and both candidate workspaces with no cleanup, retry, or rollback;
9. after success, re-proves live main did not move and the historical workspace directory metadata did not change.

The candidate-preparation workspace created by the child helper therefore lives under the isolated one-shot run root, not at the historical global workspace path.

## Production boundary

The child remains preparation-only. It may perform read-only production probes and build/validate candidate files in operator-owned cache, but it contains no release `--apply`, service restart, systemd/identity/permission mutation, Cloudflare mutation, Actions mutation, terminal activation, retry, rollback, or cleanup.

The accepted production boundary remains unchanged until a later separately reviewed and explicitly authorized activation step:

```text
current_release=4295c23de5634dcb86b5fe9f57be92416eb9a75b
logs=200
quick=200
events=503
terminal=absent
```

## Authorization state

```text
PR170_MERGE_AUTHORIZATION=CONSUMED
PR172_MERGE_AUTHORIZATION=NONE
PRODUCTION_MUTATION_AUTHORIZATION=NONE
ACTIONS_RERUN_AUTHORIZATION=NONE
OLD_WORKSPACE_CLEANUP_AUTHORIZATION=NONE
```

After PR #172 reaches Ready, stop for an explicit owner merge decision. Only after merge may the owner run the R3 wrapper once on the RPi5. Any BLOCKED/failure/ambiguity must preserve evidence and stop. Production activation remains a later separately reviewed and explicitly authorized operation.
