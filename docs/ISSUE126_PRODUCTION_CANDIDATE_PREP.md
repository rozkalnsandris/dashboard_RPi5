# #126 production candidate preparation gate

## Fast-track position

This is the preparation-only continuation for #144 P3 after PR #160 merged the bounded Docker recent-events source path.

Source target:

- merged main: `a39fc7a9873eedb58cfa49568f9b2e05483cf7c2`;
- tree: `bd2fa68711b1cf4617088a18c524e3c60d427152`;
- source PR #160 head: `a44e95b4b480e29b8d537130903869c00fc3ef0d`;
- source CI #368 / run `32407296336`: SUCCESS;
- the PR head tree and squash-merged main tree are identical.

Current accepted production remains the completed #151/#127 release:

- current release `4295c23de5634dcb86b5fe9f57be92416eb9a75b`;
- candidate digest `f08677aef82d0213422a171b51efd46fa7db57b29385fdd9c5d185f2c7b83eb0`;
- host/Docker current-state 200;
- registered Docker logs 200;
- Quick Commands 200 with the exact four-command catalog;
- Docker recent events 503/fail-closed;
- terminal/PTTY absent;
- unauthenticated Cloudflare Access probe 302.

## Purpose

`tools/operator/issue126-production-candidate-prep.sh` prepares and verifies a fresh immutable candidate for the merged P3 source while proving that production remains unchanged.

It deliberately reuses the existing production candidate / manifest / runtime-smoke / release-controller machinery. It does not introduce another deployment mechanism.

## Source and evidence gate

Before any candidate work, the helper requires:

1. GitHub `main` equals the exact merged target and tree and has a verified signature;
2. PR #160 is merged at that target from the exact reviewed head;
3. the PR head tree equals the merged main tree;
4. CI #368 is completed/success on that exact reviewed head;
5. `check`, `terminal-native (x64)`, and `terminal-native (arm64)` are each completed/success.

The equal-tree gate is important: it proves that the exact source tree validated by CI #368 is the tree now present on merged `main`.

## Read-only production preflight

Before creating a candidate workspace, the helper proves the current accepted production baseline:

- exact current release pointer and immutable manifest/candidate digest;
- broker, agent, and web active/enabled and running from the current release;
- installed broker/agent/web unit bytes equal the immutable current release;
- Quick Commands drop-in and exact four-command catalog remain accepted;
- broker current-state and registered log capabilities are 200;
- the current broker does not expose the new #126 canonical events route;
- agent host/Docker/logs are 200 while events remain 503;
- main agent persistent/runtime Docker/video boundaries remain closed;
- only the broker process has runtime Docker Engine group authority;
- broker/agent/Docker socket metadata remain exact;
- terminal/PTTY remains absent;
- Cloudflare Access remains unchanged.

PIDs and `NRestarts` are observed dynamically. They are not hard-coded historical values; the same observed values must remain unchanged after preparation.

## Candidate preparation

All preparation writes are confined to a new operator-owned workspace:

`$HOME/.cache/dashboard-rpi5-candidate-prep/a39fc7a9873eedb58cfa49568f9b2e05483cf7c2-issue126`

The helper refuses to reuse or clean an existing workspace.

Inside that workspace it:

1. fetches the exact merged target and verifies its tree;
2. pins the bounded #126 source contract;
3. runs locked install, high-severity audit and full `npm run check`;
4. generates and verifies the deterministic production candidate manifest;
5. requires the broker, agent, server and three systemd blueprint paths in the manifest;
6. runs manifest-only production runtime smoke;
7. invokes the canonical release controller in **PLAN mode only**.

## #126 bounded authority contract

The preparation gate requires the merged source to preserve:

- canonical broker route `/v1/docker/events/recent`;
- maximum requested event window 3600 seconds;
- maximum broker raw event items 512;
- maximum normalized agent event items 256;
- Docker Engine method GET only;
- server-owned Docker event filter construction;
- typed `broker.readEvents(since, until, signal)` transport;
- live agent wiring through `readLiveRecentDockerEvents`;
- no caller-supplied Engine path or generic Docker proxy;
- main agent never gains direct Docker or video authority.

## End state

After candidate verification and release PLAN, the helper re-proves:

- current pointer unchanged;
- target release still absent;
- release-controller lock absent;
- broker/agent/web PIDs and restart counters unchanged;
- broker/agent/web CWDs unchanged;
- Docker logs remain 200;
- Quick Commands remain 200;
- Docker events remain 503;
- terminal remains absent;
- Cloudflare Access remains unchanged.

Expected successful terminal markers are:

```text
ISSUE126_CANDIDATE_PREPARATION_READY ...
ISSUE126_CANDIDATE_PREP_STOP production_mutation=NO release_apply=NO ... events=503 ...
```

## Explicit non-actions

This preparation helper contains no production release apply, current-pointer mutation, systemd service start/stop/restart/reload/enable/disable, unit installation, identity/group mutation, permission widening, Cloudflare mutation, Actions rerun/cancel, terminal activation, Docker events activation, automatic retry, rollback or cleanup.

Candidate preparation is not production activation.

```text
PRODUCTION_MUTATION_AUTHORIZATION=NONE
MERGE_AUTHORIZATION=NONE
ACTIONS_RERUN_AUTHORIZATION=NONE
```

After this source gate reaches Ready, the next step is an owner-run immutable preparation helper on the RPi5 as the normal operator. A later activation helper and production mutation require their own reviewed source and a new explicit owner authorization.
