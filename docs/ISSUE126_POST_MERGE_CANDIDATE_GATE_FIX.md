# #126 post-merge candidate-prep source-gate fix

## Problem

PR #161 merged the audited candidate-preparation helper after the immutable P3 source target. The helper correctly pins candidate source `a39fc7a9873eedb58cfa49568f9b2e05483cf7c2`, but its source gate also requires live GitHub `main` to equal that same target. After #161 merged, live `main` became `1a0f6f6788fdcf8719c4c4d0b1976eb406f9fe3b`, so the merged helper would deterministically block before production preflight.

Production is not affected. Docker recent events remain 503/fail-closed.

## Fix model

Keep the immutable candidate target unchanged:

```text
TARGET=a39fc7a9873eedb58cfa49568f9b2e05483cf7c2
TARGET_TREE=bd2fa68711b1cf4617088a18c524e3c60d427152
```

Separate candidate-source proof from current-main helper-gate proof.

The corrected helper will:

1. prove PR #160, its exact head, CI #368, merge target and candidate tree exactly as before;
2. prove current `main` has a verified signature;
3. prove current `main` is exactly the squash merge commit of this follow-up fix PR from its exact reviewed head;
4. prove that merge commit has exactly one parent equal to the pre-fix main `1a0f6f6788fdcf8719c4c4d0b1976eb406f9fe3b`;
5. reject any later `main` commit or unrelated lineage;
6. fetch/build/verify only the immutable P3 candidate target, never the helper-only current main.

The follow-up PR number and exact head are bound into the helper before the PR can move to Ready.

## Safety boundary

This is source-only work. It does not authorize or perform production release apply, service restart, systemd/identity/permission mutation, Docker authority widening, Cloudflare mutation, terminal activation, Docker events activation, Actions rerun/cancel, automatic retry, rollback or cleanup.

```text
PRODUCTION_MUTATION_AUTHORIZATION=NONE
MERGE_AUTHORIZATION=NONE
ACTIONS_RERUN_AUTHORIZATION=NONE
```
