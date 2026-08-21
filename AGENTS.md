# AGENTS.md — dashboard_RPi5

These rules are mandatory for humans and coding agents working in this repository.

## 1. Source of truth

GitHub is authoritative for:

- repository state;
- issues;
- pull requests;
- commits/SHA;
- reviews;
- CI;
- the canonical master contract in issue #1.

Do not trust stale chat state when GitHub has moved.

Before any merge/deploy decision, refresh current GitHub evidence.

## 2. Canonical product contract

Read first:

1. issue `#1 — [MASTER / READ FIRST] dashboard_RPi5 — product contract, architecture and delivery roadmap`;
2. `SECURITY.md`;
3. `docs/ROADMAP.md`;
4. the phase-specific design/security documents.

If implementation intent conflicts with issue #1, amend the contract explicitly first. Do not silently drift.

## 3. Normal workflow

```text
issue
  -> fresh main
  -> fresh focused branch
  -> focused change
  -> local validation
  -> push
  -> Draft PR
  -> exact-head CI
  -> exact diff/manual review
  -> resolve review threads
  -> Ready
  -> STOP
  -> explicit owner squash merge
  -> exact-main verification
  -> Production deploy: YES / NO
```

`turpini` / “continue” authorizes source-only work up to Ready when the task is otherwise clear. It does not authorize merge or production mutation.

### FAST and STRICT work lanes

The lane changes batching and validation cost only. It never changes the owner merge gate, production gate, fail-closed mutation rules, or security invariants.

Use **FAST** for coherent low-risk work that does not add or expand host/runtime authority, for example documentation/status corrections, non-privileged UI copy/presentation cleanup, tests-only maintenance, and bounded source cleanup. Related low-risk issues may share one focused branch/PR when they produce one coherent outcome. Do not split one bounded documentation/cleanup result into multiple PRs merely to preserve one-issue-per-PR ceremony.

Use **STRICT** for first-time or expanded trust boundaries and production-sensitive control paths. Keep these isolated, including Docker Engine authority, systemd/host privilege, terminal/PTTY capability, Cloudflare Access/Tunnel/DNS, secrets/permissions, controlled write actions, and production deployment/activation controllers.

For a clear source-only task, `START` / `turpini` may execute the full safe pre-Ready batch without conversational STOP points after intermediate source steps:

```text
fresh main
  -> one focused branch
  -> coherent source changes
  -> focused validation
  -> one push
  -> one PR
  -> exact-head CI
  -> one exact-diff/review pass
  -> Ready
  -> STOP for explicit owner merge
```

Stop earlier only for a real blocker, changed intent, or authorization boundary.

CI may select validation lanes from the exact changed-file set. Classification must fail open: ambiguous, workflow/toolchain, host-boundary, or otherwise unknown changes receive the full validation surface. Intentional skipped jobs must remain explicit successful/skipped outcomes rather than suppressing the whole required workflow.

## 4. Merge gate

Never merge without an explicit owner instruction such as:

```text
squash merge #123
merge #123
```

Immediately before merge, freshly verify:

- current `main`;
- PR base;
- exact PR head SHA;
- mergeability;
- draft/ready state;
- exact-head CI;
- unresolved review threads;
- required checks;
- whether `main` moved due to parallel work.

If the PR head/base/current main changed, re-evaluate instead of using old evidence.

For a non-STRICT source-only squash merge, exact-main verification may use immutable commit/tree evidence when all of the following are proven: the merged PR used the exact reviewed head, its base was the freshly verified pre-merge `main`, the new `main` has that base as its sole parent, and the new `main` tree is identical to the exact-head CI-tested PR tree. If any element is ambiguous, if `main` drifted, or if the change is STRICT/production-sensitive, do not substitute tree equivalence for the stronger required verification.

## 5. Deploy classification and gate

After **every merge**, always state exactly one:

```text
Production deploy: YES
```

or:

```text
Production deploy: NO
```

This is a classification only.

**Merge authorization is not deploy authorization.**

Never deploy merely because `Production deploy: YES`.

## 6. Separate owner authorizations

Require separate explicit owner authorization for:

- production deployment to `dash.rozkalns.net`;
- Cloudflare DNS/Tunnel/Access mutation;
- secrets/tokens/credentials;
- installation/enabling/restarting of production systemd units;
- Docker socket/trust-boundary permission expansion;
- Docker group membership changes;
- host/root mutation;
- production package/image updates;
- production container/service restart/stop/remove;
- backup/deployment-controller mutation;
- first live agent activation;
- first live Docker read permission;
- Quick Command production activation;
- full PTY terminal activation;
- sudo/root access from dashboard components;
- any write capability.

Source-only implementation may prepare a future gated capability, but activation remains separate.

## 7. Security style

Always prefer:

- least privilege;
- fail closed;
- exact target / exact SHA where applicable;
- allowlists over generic pass-through APIs;
- typed/runtime-validated boundaries;
- bounded timeouts/output/concurrency;
- stale/unknown state over fabricated healthy data.

Never:

- concatenate browser input into shell commands;
- use arbitrary `sh -c` for Quick Commands;
- expose Docker Engine as a generic proxy;
- expose Docker socket to browser/web frontend;
- build a generic root web shell;
- accept arbitrary log filesystem paths;
- store secrets in repo, screenshots, fixtures or frontend bundles;
- render logs/terminal output with `innerHTML`.

## 8. Scope discipline

Keep trust-boundary expansions isolated.

Examples that should normally be separate PRs:

- first frontend foundation;
- first live host metrics;
- first agent systemd service;
- first Docker socket access;
- first Prometheus history;
- first journal/Docker live logs;
- first Quick Command;
- first PTY terminal;
- first write action;
- first Cloudflare production route;
- first production deployment.

Do not combine UI polish with a first-time privileged capability unless the contract explicitly requires it.

## 9. Samsung Galaxy A55 contract

A55 is the primary physical mobile acceptance device.

Do not use device model/UA sniffing for layout.

UI changes affecting mobile must preserve:

- 320 CSS px reflow;
- A55-class 412×915 regression target;
- Samsung Browser + Chrome compatibility;
- browser + PWA behavior where applicable;
- zoom;
- safe areas;
- keyboard-safe search/log/terminal flows;
- 48px normal touch targets;
- no hover-only required behavior.

## 10. Documentation

Architecture, security and behavior documentation change in the same PR as the behavior.

When a phase gate changes, update:

- issue #1 if the canonical contract changed;
- `docs/ROADMAP.md`;
- relevant ADR/spec;
- README when current status changes.

Ready evidence should be consolidated once per PR after final exact-head CI/review. Do not repeatedly rewrite the same evidence after every source-only micro-step. Immediately before merge, refresh only mutable merge-gate evidence required by section 4.

Continuity should stay compact: issue #1 is the durable product/security/governance contract, while PRs/issues/CI carry exact execution evidence. Create or refresh a CURRENT handoff only for meaningful phase/gate transitions; historical handoffs never override fresh GitHub state.

## 11. Stop conditions

Stop and ask for owner authorization when the next step would cross a production/trust boundary.

Do not disguise a production mutation as “verification”.

If a live command changes host/container/service/Cloudflare state, it is a mutation and requires authorization.
