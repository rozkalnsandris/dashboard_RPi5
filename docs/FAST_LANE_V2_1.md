# FAST-LANE v2.2 Composite — dashboard_RPi5

> Compatibility path: this repository keeps the v2.1 filename so existing links remain stable. The contents are the dashboard-specific FAST-LANE v2.2 rules. The canonical cross-project policy is maintained in `rozkalnsandris/ops-workflows`; repository-local stricter security boundaries always win.

## Core rule

**The human approves the RISK / DECISION. Automation executes the TECHNICAL STEPS.**

STRICT describes mutation risk, not the number of human interactions. Read-only checkpoints do not create owner gates.

## FAST source envelope

For source-only work, `START`, `turpini`, or an equivalent continuation instruction may proceed in one coherent batch from fresh canonical GitHub state through Ready:

```text
fresh state -> branch -> implementation -> focused validation -> push
            -> Draft PR -> CI/review -> up to 2 scope-preserving corrections
            -> Ready receipt -> STOP for merge
```

FAST may batch 2-5 closely related same-risk work items when they form one reviewable acceptance story. FAST never authorizes merge or a live mutation.

## Human gate budget

The normal end-to-end delivery path has at most two owner decision gates:

1. **MERGE** — explicit authorization to merge the exact Ready PR/head.
2. **COMPOSITE LIVE** — only when a production/host/trust-boundary mutation is actually required.

Do not invent separate owner gates for CI polling, GET/preflight, evidence refresh, diff inspection, checkout discovery, clean/ancestor checks, build preparation, candidate verification, reconciliation, or other read-only work.

A new STOP is justified only when:

- merge authorization is required;
- one composite live authorization is required;
- an authorized mutation has started and an error or ambiguous result occurs;
- a new scope, trust boundary, target, SHA, or risk class appears.

## Composite STRICT authorization envelope

Before requesting live authorization, collect all obtainable read-only evidence. Ask once for one bounded execution envelope that states:

- repository and exact approved Git SHA/ref;
- exact live target/environment;
- allowed mutation categories;
- hard mutation-count or operation limits where practical;
- explicit exclusions;
- expected pre-mutation production/runtime baseline when relevant.

For `dashboard_RPi5`, a Composite Live authorization may cover tightly coupled operations needed for one exact rollout, such as release activation plus the explicitly named service restarts and final reconciliation. It does not authorize a category that was not named in the envelope.

If the approved SHA, target, or baseline changes before the first mutation, fail closed and STOP. Never silently deploy a newer `main` than the owner approved.

## One-shot execution

After Composite Live authorization, prefer one fail-closed controller/script rather than returning to the owner for technical checkpoints. As applicable, the one-shot should include:

1. exact GitHub/main/CI evidence;
2. production/runtime baseline read;
3. local checkout/candidate validation;
4. revalidation of approved SHA and baseline immediately before first live write;
5. deterministic build with repository-pinned tooling;
6. build once and verify the exact candidate/artifact;
7. concurrency/drift guard immediately before rollout;
8. one bounded rollout of the exact verified candidate;
9. GET/read-only reconciliation;
10. one final live receipt.

Do not rebuild or silently substitute a newer artifact between candidate verification and rollout.

## Failure, rollback, and drift

Authorization is consumed when the first authorized mutation starts. After that point, any error, ambiguity, unexpected drift, or scope expansion requires evidence preservation and STOP.

Default behavior is **no automatic retry, rollback, cleanup, alternate mutation path, reset, rebase, or extra restart**. Such behavior is allowed only when the exact operation contract explicitly pre-authorized it and its safety prerequisites were proven before the first mutation.

Only one bounded live rollout should own the production target at a time. Immediately before a live write, re-read the expected authoritative baseline when available; if another actor changed it, STOP instead of adapting automatically.

## Dashboard STRICT boundaries

Always require an explicit Composite Live authorization envelope for any included live category, including:

- production deployment to `dash.rozkalns.net`;
- first live host/agent activation;
- Docker socket/group/Engine authority;
- journal/live-log authority expansion;
- Quick Command or PTY terminal activation;
- sudo/root/systemd/service/container mutation;
- Cloudflare DNS/Tunnel/Access mutation;
- secrets/credentials;
- any production write.

A source merge does not activate any of these capabilities. Existing least-privilege, broker-only Docker authority, terminal fail-closed, and other repository security invariants remain unchanged.

## CI classification

The current dashboard CI remains risk-scoped and fail-open:

- `docs-only`: documentation/repository guidance only; expensive Node/browser/native lanes are skipped;
- `web`: core + runtime contract + responsive browser validation;
- `runtime`: server/agent/contracts changes keep core + runtime validation without browser/native PTY work;
- `e2e`: core + responsive browser validation;
- `terminal`: core + runtime + native PTY x64/arm64 validation;
- workflow, dependency/toolchain, `ops/**`, classifier/tool changes, unknown paths, or missing diff evidence fail open to the full validation surface.

The classifier implementation remains `tools/ci-scope.mjs` with focused tests in `tools/ci-scope.test.mjs`. Pushes to `main` are classified from exact before/after SHAs; missing or ambiguous comparison evidence fails open. The stable aggregate status remains `FAST-LANE Merge Gate`.

## Evidence and operator UX

Use one Ready receipt for source work and one final live receipt after a Composite Live execution. Do not ask the owner to shuttle intermediate command output unless execution has genuinely stopped.

A live receipt should record at least result/failed stage, approved and observed SHA, target and before/after version, actual mutation categories/counts, candidate/reconciliation result, whether mutation started, and the exact next human decision if one remains.

Human decisions belong at the **end** of the report under one visible `ACTION REQUIRED` section. When the owner must run or enter something, provide the exact copyable instruction in a fenced `bash` block.

## Merge invariant

Merge remains an explicit owner decision. Merge never authorizes deployment, host/root/systemd/Docker/Cloudflare mutation, secrets, Quick Command/PTTY activation, or another live write.
