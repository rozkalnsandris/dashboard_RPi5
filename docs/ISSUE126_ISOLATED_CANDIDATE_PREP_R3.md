# Issue #126 isolated candidate-prep R3

## Purpose

Preserve the historical incomplete candidate-preparation workspace as evidence and provide a new one-shot preparation wrapper that does not delete, reuse, rename, or otherwise mutate that workspace.

This is source-only preparation. It does not authorize production activation, release apply, service restart, systemd/identity/permission changes, Docker authority changes, Cloudflare changes, terminal activation, or GitHub Actions reruns.

## Immutable base and helper source

PR #170 was squash-merged as the immutable base for this recovery step:

```text
base_main=db6c4383b33dd9902094c54afd60e51a161f8f4c
base_tree=1a457416331357c54e9dae278769a4ef3690bd7c
merged_helper_blob=3541750f511289056c4a4b8d684db139b9c903eb
immutable_candidate_target=a39fc7a9873eedb58cfa49568f9b2e05483cf7c2
immutable_candidate_tree=bd2fa68711b1cf4617088a18c524e3c60d427152
```

The R3 wrapper itself is carried by PR #172. After merge it must not require live `main` to remain equal to `db6c4383...`; instead it must prove that live `main` is exactly the PR #172 squash descendant of that immutable base.

## R2 stop receipt

The R2 owner-run wrapper passed the immutable GitHub gate and the helper passed its read-only production preflight. It then failed closed at the helper `fresh-workspace` guard because the historical global candidate workspace already existed.

The final helper receipt explicitly reported no production mutation, no release apply, no systemd/identity/permission mutation, no Cloudflare mutation, no service restart, no Actions mutation, no retry, and no cleanup.

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

The timestamps show checkout/dependency/build activity, including application build outputs. The absent manifest proves this directory is not a completed/proven production candidate. It is retained as historical partial preparation evidence.

No cleanup or reuse is required for R3.

## R3 post-merge lineage gate

`tools/operator/issue126-production-candidate-prep-isolated-wrapper.sh` requires, after PR #172 is merged:

1. immutable base `db6c4383...` still exists with tree `1a457416...` and verified signature;
2. PR #172 is closed/merged with exact base `db6c4383...`;
3. PR #172 merge commit is exactly live GitHub `main`;
4. that live main has a verified signature, exactly one parent, and parent `db6c4383...`;
5. compare `db6c4383... -> live main` is exactly one squash commit, not behind, and changes only:
   - `docs/ISSUE126_ISOLATED_CANDIDATE_PREP_R3.md`;
   - `package.json`;
   - `tools/issue126-production-candidate-prep-isolated-wrapper.test.mjs`;
   - `tools/operator/issue126-production-candidate-prep-isolated-wrapper.sh`;
6. natural exact-head PR #172 CI is completed/success and includes `check`, `terminal-native (x64)`, and `terminal-native (arm64)`;
7. the preparation helper is fetched only from immutable base `db6c4383...` and must retain blob `3541750f...`.

Any later `main` commit fails closed.

## R3 isolation model

After the post-merge lineage gate passes, the wrapper:

1. requires normal operator `andris` on Raspberry Pi 5 Model B;
2. creates a one-shot run root keyed to the actual PR #172 squash merge SHA;
3. preserves the historical global candidate workspace unchanged;
4. creates a fresh isolated HOME below the one-shot run root;
5. runs the unchanged PR170-merged preparation-only helper with that isolated HOME, causing the helper to create a fresh candidate workspace under the isolated run root rather than colliding with the historical global workspace;
6. captures helper output into the one-shot run root;
7. on any BLOCKED/failure, preserves all evidence and stops with no cleanup, retry, rollback, or production authorization.

The wrapper itself contains no `rm`, `mv`, release `--apply`, or service start/stop/restart/enable/disable operation.

## Known non-blocking warning

The merged helper currently captures the body of the old Docker-events 404 probe in Bash command substitution. The observed response contained a NUL byte, so Bash printed `warning: command substitution: ignored null byte in input`. The status check still returned the expected `404` and the complete read-only production preflight passed.

This warning is source debt, not evidence of a production mutation and not a reason to weaken the candidate-prep gates. R3 does not rely on that response body and does not change the production boundary.

## Authorization state

```text
PR170_MERGE_AUTHORIZATION=CONSUMED
PR172_MERGE_AUTHORIZATION=NONE
PRODUCTION_MUTATION_AUTHORIZATION=NONE
ACTIONS_RERUN_AUTHORIZATION=NONE
OLD_WORKSPACE_CLEANUP_AUTHORIZATION=NONE
```

After PR #172 reaches Ready, stop for an explicit owner merge decision. Only after merge may the owner run the new wrapper once on the RPi5. Any BLOCKED/failure/ambiguity must preserve evidence and stop; production activation remains a later separately reviewed and explicitly authorized operation.
