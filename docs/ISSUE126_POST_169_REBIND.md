# Issue #126 post-#169 candidate-prep rebind

## Purpose

Rebind the already-reviewed #126 production candidate-preparation gate after PR #169 advanced `main` for the Node 24 type-alignment cleanup.

This change does **not** change the immutable Docker-events candidate target:

- target: `a39fc7a9873eedb58cfa49568f9b2e05483cf7c2`
- tree: `bd2fa68711b1cf4617088a18c524e3c60d427152`
- source PR: #160
- source CI: #368

## Required lineage

The helper must prove the exact reviewed chain:

1. PR #162 is the squash descendant of `1a0f6f6788fdcf8719c4c4d0b1976eb406f9fe3b` and merged as `ffef15e355b97efc3319fd4cd86584d8761fc961` with the exact four candidate-gate files.
2. PR #169 is the next squash commit, based on `ffef15e355b97efc3319fd4cd86584d8761fc961`, with exact head `4e5513cced4f39e57f16829403acf2a7219dcbd0`, CI #380 successful, and only `package.json` plus `package-lock.json` changed.
3. This rebind PR must itself become exactly one squash commit on top of PR #169. After merge, the helper may accept only that merge as live `main` and must verify the exact changed-file boundary of the rebind PR.
4. The helper must also discover and require a completed/successful CI run on the exact final PR #170 head, including `check`, `terminal-native (x64)`, and `terminal-native (arm64)`; an earlier head or merely mergeable PR is not sufficient.

The helper must remain preparation-only: no release apply, service restart, systemd/identity/permission mutation, Cloudflare mutation, Actions mutation, automatic retry, rollback, or cleanup.

## Production boundary

The accepted production baseline remains `4295c23de5634dcb86b5fe9f57be92416eb9a75b`. Candidate prep must re-prove host/Docker current state, registered Docker logs and Quick Commands remain healthy, Docker recent events remain `503`, terminal/PTTY remains absent, and Cloudflare Access remains unchanged.

No production mutation is authorized by this document or its PR.
