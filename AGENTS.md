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

## 11. Stop conditions

Stop and ask for owner authorization when the next step would cross a production/trust boundary.

Do not disguise a production mutation as “verification”.

If a live command changes host/container/service/Cloudflare state, it is a mutation and requires authorization.
