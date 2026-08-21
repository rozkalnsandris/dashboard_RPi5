# Issue #126 isolated candidate-prep R3

## Purpose

Preserve the historical incomplete candidate-preparation workspace as evidence and provide a new one-shot preparation wrapper that does not delete, reuse, rename, or otherwise mutate that workspace.

This is source-only preparation. It does not authorize production activation, release apply, service restart, systemd/identity/permission changes, Docker authority changes, Cloudflare changes, terminal activation, or GitHub Actions reruns.

## Reviewed lineage

The wrapper is pinned to the post-PR170 state:

```text
main=db6c4383b33dd9902094c54afd60e51a161f8f4c
main_tree=1a457416331357c54e9dae278769a4ef3690bd7c
main_parent=4fd40cd0cc639bad84463b9680e627f8e02157e2
pr170_head=514a6405d2bbd66938e4a85eec722d172e2efd93
merged_helper_blob=3541750f511289056c4a4b8d684db139b9c903eb
immutable_candidate_target=a39fc7a9873eedb58cfa49568f9b2e05483cf7c2
immutable_candidate_tree=bd2fa68711b1cf4617088a18c524e3c60d427152
```

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

## R3 isolation model

`tools/operator/issue126-production-candidate-prep-isolated-wrapper.sh`:

1. requires normal operator `andris` on Raspberry Pi 5 Model B;
2. is one-shot and keyed to the exact PR170 squash-merged main;
3. re-proves main SHA/tree/parent/signature and PR170 head/merge lineage;
4. fetches the merged helper only from exact `db6c4383...` and requires blob `3541750f...`;
5. preserves the historical global candidate workspace unchanged;
6. creates a fresh isolated HOME under its one-shot run root;
7. runs the unchanged merged preparation-only helper with that isolated HOME, causing the helper to create a fresh candidate workspace under the isolated run root rather than colliding with the historical global workspace;
8. captures helper output into the one-shot run root;
9. on any BLOCKED/failure, preserves all evidence and stops with no cleanup, retry, rollback, or production authorization.

The wrapper itself contains no `rm`, `mv`, release `--apply`, or service start/stop/restart/enable/disable operation.

## Known non-blocking warning

The merged helper currently captures the body of the old Docker-events 404 probe in Bash command substitution. The observed response contained a NUL byte, so Bash printed `warning: command substitution: ignored null byte in input`. The status check still returned the expected `404` and the complete read-only production preflight passed.

This warning is source debt, not evidence of a production mutation and not a reason to weaken the candidate-prep gates. R3 does not rely on that response body and does not change the production boundary.

## Authorization state

```text
PR170_MERGE_AUTHORIZATION=CONSUMED
PRODUCTION_MUTATION_AUTHORIZATION=NONE
ACTIONS_RERUN_AUTHORIZATION=NONE
R3_MERGE_AUTHORIZATION=NONE
OLD_WORKSPACE_CLEANUP_AUTHORIZATION=NONE
```

After R3 reaches Ready, stop for an explicit owner merge decision. Only after merge may the owner run the new wrapper once on the RPi5. Any BLOCKED/failure/ambiguity must preserve evidence and stop; production activation remains a later separately reviewed and explicitly authorized operation.
