# FAST-LANE v2.2 Composite — dashboard_RPi5

> Compatibility path: `AGENTS.md` already points to this v2.1 filename; the contents here are the authoritative v2.2 rules.

## Core rule

**The human approves the RISK / DECISION. Automation executes the TECHNICAL STEPS.** STRICT is a risk classification, not a reason to ask for approval at every checkpoint. Read-only work never creates an owner gate.

## FAST

Source/UI/tests/docs/refactors may proceed from fresh GitHub state through Ready in one batch, including branch, commits, PR, CI/review and up to two scope-preserving corrections. Closely related same-risk work may be batched 2-5 items. Merge remains explicit.

## Human gate budget

Normal delivery has at most two owner gates: **MERGE**, then **COMPOSITE LIVE** only when live deployment/host mutation is required. CI polling, diff inspection, GET/preflight, checkout discovery, clean/ancestor checks, build preparation, candidate verification and reconciliation are automation steps, not owner gates.

## Composite STRICT

A single live authorization may cover the tightly coupled operations needed for one rollout when it binds the exact Git SHA, exact target, allowed mutation categories, hard limits and explicit exclusions. Preflight belongs at the start of the same one-shot and must fail closed before the first live mutation. Revalidate SHA/target/baseline immediately before live write; stop on drift.

Where deployment creates an artifact/version: use a pinned toolchain, build once, verify the exact candidate, deploy that exact artifact/version once, then reconcile read-only. Do not silently rebuild or deploy newer `main`.

## Local STRICT boundaries

Separate live authorization is required for first live host metrics/agent activation, Docker socket/group/engine authority, journal/live-log expansion, Quick Command/PTY activation, sudo/root/systemd/service/container mutation, production deploy, Cloudflare DNS/Tunnel/Access, secrets/credentials or another production write.

## Failure and evidence

Authorization is consumed at the first authorized mutation. Any error/ambiguity after that requires evidence preservation and STOP; no automatic retry, rollback, cleanup, reset, rebase or alternate mutation path unless explicitly pre-authorized.

Use one Ready receipt and one final live receipt. Put any remaining owner decision at the **end** under one visible `ACTION REQUIRED` section; when the owner must enter/run something, provide the exact copyable instruction in a fenced `bash` block.

Merge never authorizes deployment or another live mutation.
