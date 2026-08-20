# #126 post-merge candidate-prep source-gate fix

## Problem

PR #161 merged the audited candidate-preparation helper after the immutable P3 source target. The helper correctly pins candidate source `a39fc7a9873eedb58cfa49568f9b2e05483cf7c2`, but its source gate also requires live GitHub `main` to equal that same target. After #161 merged, live `main` became `1a0f6f6788fdcf8719c4c4d0b1976eb406f9fe3b`, so the merged helper would deterministically block before production preflight.

Production is not affected. Docker recent events remain 503/fail-closed.

## Fix model

Keep the immutable candidate target unchanged:

```text
TARGET=a39fc7a9873eedb58cfa49568f9b2e05483cf7c2
TARGET_TREE=bd2fa68711b1cf4617088a18c524e3c60d427152
FIX_PR=162
FIX_BASE=1a0f6f6788fdcf8719c4c4d0b1976eb406f9fe3b
```

Separate candidate-source proof from current-main helper-gate proof.

The corrected helper:

1. proves PR #160, its exact head, CI #368, merge target and candidate tree exactly as before;
2. proves the immutable candidate target itself has the exact tree and a verified signature;
3. proves current `main` has a verified signature;
4. proves PR #162 is closed/merged from exact base `1a0f6f67...` and its merge commit is exactly live `main`;
5. proves that live merge commit has exactly one parent equal to `1a0f6f67...`;
6. proves the compare from that parent to live main is exactly one squash commit and changes only the four audited candidate-preparation gate files;
7. rejects any later `main` commit, unrelated lineage or changed-file expansion;
8. fetches/builds/verifies only immutable P3 candidate target `a39fc7a9...`, never the helper-only current main.

The helper intentionally does **not** hard-code its own PR head SHA: embedding a file's resulting commit SHA inside that same file is self-referential and cannot converge. Exact-head CI and review evidence are enforced at the normal Ready/explicit-merge gate; runtime then proves the merged PR identity, exact parent and exact changed-file boundary without a cyclic self-hash.

## Exact changed-file boundary

PR #162 is restricted to:

- `docs/ISSUE126_POST_MERGE_CANDIDATE_GATE_FIX.md`;
- `docs/ISSUE126_PRODUCTION_CANDIDATE_PREP.md`;
- `tools/issue126-production-candidate-prep-helper.test.mjs`;
- `tools/operator/issue126-production-candidate-prep.sh`.

No application/runtime, systemd, identity, Cloudflare or production file is changed.

## Safety boundary

This is source-only work. It does not authorize or perform production release apply, service restart, systemd/identity/permission mutation, Docker authority widening, Cloudflare mutation, terminal activation, Docker events activation, Actions rerun/cancel, automatic retry, rollback or cleanup.

```text
PRODUCTION_MUTATION_AUTHORIZATION=NONE
MERGE_AUTHORIZATION=NONE
ACTIONS_RERUN_AUTHORIZATION=NONE
```
