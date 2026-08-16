# Phase 11B — production candidate, rollback and smoke contract

Status: **source-only / not deployed**.

Issue: #71. Master contract: #1.

Fresh baseline for this phase: `main` `5ac6d82adc11840940650dcf5105ec6cc8ae1556`, exact-main CI #234 / run `31948201815` = `SUCCESS`.

## Purpose

Phase 11A defined the production identities, immutable release layout and read-only host preflight. Phase 11B closes the remaining source-side launch prerequisites without changing the Raspberry Pi or Cloudflare.

It adds:

- an exact-SHA production candidate manifest;
- build-content SHA-256 evidence;
- a deterministic rollback/recovery contract;
- Cloudflare Access/Tunnel launch ordering;
- a machine-readable post-deploy smoke contract.

Nothing in this phase authorizes production activation.

## Candidate identity

A production candidate is identified by two values:

```text
sourceSha
candidateSha256
```

`sourceSha` is the exact reviewed Git commit.

`candidateSha256` is the SHA-256 digest of the canonical candidate manifest. The manifest itself contains the SHA-256 and byte size of every included production file.

The intended immutable release path is derived only from the exact source SHA:

```text
/opt/dashboard_RPi5/releases/<40-char-exact-sha>
```

No timestamp, hostname, environment-specific secret or mutable production observation participates in the candidate identity.

## Candidate allowlist

`tools/production-candidate-manifest.mjs` includes only explicit production roots.

Build trees:

- `apps/web/dist`;
- `apps/server/dist`;
- `apps/agent/dist`;
- `apps/terminal-agent/dist`;
- `packages/contracts/dist`.

Reproducibility/runtime metadata:

- root `package.json` + `package-lock.json`;
- workspace package manifests.

Production source contracts:

- launch contract;
- base web environment example;
- owner-gated terminal environment example;
- smoke contract;
- web/agent/terminal systemd blueprints.

The walker rejects symlinks and all non-regular file types. Paths are sorted deterministically before the manifest digest is calculated.

## Generate and verify

After a production build:

```text
npm run manifest:production -- \
  --root . \
  --sha <exact-source-sha> \
  > /tmp/dashboard-rpi5-production-candidate.json
```

Verification re-hashes the exact build contents:

```text
npm run manifest:production -- \
  --root . \
  --sha <exact-source-sha> \
  --verify /tmp/dashboard-rpi5-production-candidate.json
```

Any changed, missing, extra-allowlisted or symlinked candidate content causes verification to fail closed.

The tool does not install, copy, enable, restart or deploy anything. It reads candidate inputs and writes JSON only to stdout. Redirecting stdout is an operator/CI choice outside the tool.

## CI exact-SHA rule

GitHub pull-request workflows normally have a synthetic merge context available. That synthetic merge commit is useful for compatibility testing but must not become the production candidate identity.

CI therefore explicitly checks out:

```text
pull_request -> github.event.pull_request.head.sha
push         -> github.sha
```

The candidate manifest is generated only after the production build and is bound to that same exact source SHA.

No workflow artifact is uploaded in Phase 11B. GitHub commit history remains the source of truth; a future owner-authorized deploy can regenerate and record candidate evidence from the exact approved source/build.

## Cloudflare launch ordering

The reviewed launch order is fail-closed:

1. create/review the Cloudflare Access self-hosted application for `dash.rozkalns.net`;
2. create the owner-only Allow policy and verify unmatched users remain denied;
3. only then publish the Tunnel route to the loopback dashboard service;
4. retain origin-side `Cf-Access-Jwt-Assertion` verification;
5. perform unauthenticated and authenticated smoke checks;
6. record exact production SHA only after post-deploy verification passes.

Do not publish the hostname first and add Access later.

Cloudflare references used for this design:

- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://developers.cloudflare.com/cloudflare-one/access-controls/policies/

No Cloudflare API call or configuration mutation occurs in Phase 11B.

## Rollback / recovery contract

Before a future authorized activation, record:

- current production exact SHA, if one exists;
- candidate exact source SHA;
- candidate manifest digest;
- previous verified release directory;
- units expected to be affected;
- smoke evidence required after activation.

A rollback target must be an **already verified exact release**, not a branch name and not "latest".

The previous verified release must not be deleted during the same activation operation.

A future owner-authorized rollback consists conceptually of:

1. confirm the current production exact SHA;
2. confirm the previous verified release and its evidence still exist;
3. switch `/opt/dashboard_RPi5/current` back to that exact release;
4. restart only the explicitly affected units;
5. rerun local and public smoke checks;
6. record the resulting production SHA and classification.

If the previous verified release or its evidence is unavailable, rollback is **BLOCKED**. Phase 11B contains no command that performs the switch or restart.

## Post-deploy smoke contract

`ops/production/smoke-contract.json` is the machine-readable baseline.

Future authorized launch verification must prove at minimum:

### Local web

```text
GET http://127.0.0.1:8787/api/health
```

Expected:

- HTTP 200;
- service `dashboard-rpi5-server`.

### Local agent

Unix HTTP through:

```text
/run/dashboard-rpi5/agent.sock
GET /v1/health
```

Expected:

- HTTP 200;
- service `dashboard-rpi5-agent`.

The raw agent socket remains local-only.

### Public unauthenticated

`https://dash.rozkalns.net/` must be stopped by Cloudflare Access before dashboard origin content is returned. An Access challenge or Access denial is acceptable; reaching dashboard content is not.

### Public authenticated

After owner authentication:

- dashboard root loads;
- `/api/health` succeeds;
- no raw agent endpoint is reachable publicly;
- Docker socket is not public;
- terminal socket is not public.

### Capability defaults

Base launch keeps:

- Quick Commands disabled;
- full terminal disabled.

Those capabilities require their own owner-authorized production activation.

### A55

Physical Samsung Galaxy A55 smoke remains required in:

- Chrome;
- Samsung Internet;
- portrait;
- landscape;
- installed PWA path where applicable.

## Explicit non-actions

Phase 11B does **not**:

- deploy to RPi5;
- create a production release directory;
- modify `/opt`, `/etc`, `/run` or `/var/lib`;
- call `systemctl`;
- create/change users or groups;
- change Unix socket permissions;
- enable Quick Commands;
- enable full terminal;
- modify Cloudflare Access, Tunnel or DNS;
- create or rotate secrets/tokens;
- add Phase 10 controlled write actions.

**Production deploy: NO.**
