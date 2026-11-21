# ADR-0008 — Native immutable-release deployment profile

**Status:** Proposed; source-only architecture approved 2026-11-21, accepted after merge.  
**Related:** #1, #213, #309, ADR-0005, `docs/PHASE11D_RELEASE_ACTIVATION.md`, `ops-workflows/docs/SIMPLE_DEPLOY_V1_PLAN.md`, `RPi5_main/docs/AUTOMATION_MASTER_PLAN.md`.

## Decision

Keep the trusted root-owned immutable `dashboard_RPi5` release-controller, native `systemd` units, fixed Unix sockets, and broker-exclusive Docker Engine authority. Implement a separate **native release profile** for source-only contract validation and future reusable GitHub-side artifact preparation. The shared ordinary **Docker/Compose SIMPLE-DEPLOY v1 does not apply**; the new profile is not a second privileged deploy executor and is not activated.

Source surfaces:

- `ops/production/native-release-profile.json` — exact conservative policy; `automaticDeploy=false`, `mergeAuthorizesLive=false`.
- `tools/native-release-profile.mjs` and corresponding tests — read-only cross-contract checks; strict negative tests for authority/drift.
- Existing root controller, full manifest, systemd units, host configuration, secrets and production state are not changed.

## Why web/API-only container adoption is not authorized

`dashboard-rpi5-web.service` runs native Node from `/opt/dashboard_RPi5/current`, as a non-root user with only the agent-client group and loopback/Unix-socket dependencies. The production release manifest includes `apps/web`, `apps/server`, `apps/agent`, `apps/terminal-agent`, contracts, the Docker broker and reviewed systemd files. The only component allowed direct Docker Engine socket authority is the separate bounded broker. A Dockerized web/API would change service identity, socket permissions, immutable release closure and trusted activation sequencing; this decision explicitly does not permit those changes.

Shared SIMPLE-DEPLOY v1 builds GHCR images and runs a fixed registered Docker/Compose pull/up/health path. It cannot silently replace the dashboard's root-owned controller. Do not add a dummy SIMPLE-DEPLOY caller, a Docker socket mount or an unreviewed RPi5 deployment alias.

## Native release stages (future execution contract, **not active**)

1. **GitHub/source:** full exact-commit-SHA CI, locked Node build, arm64 native PTY packaging, full production candidate manifest, per-file SHA-256 and isolated runtime smoke; only GitHub-hosted unprivileged runners.
2. **Immutable handoff:** candidate bytes, exact SHA, complete manifest and SHA-256 receipt. GitHub-built/downloaded candidate is **untrusted data** to the privileged host. The candidate's controller JavaScript must never be run as root.
3. **Trusted read-only host preflight:** independently verify actual production current SHA, root-owned current release/controller, lock state, target, exact expected-current precondition and trusted PLAN. CI and historic runtime evidence cannot substitute for fresh host evidence.
4. **Explicit owner LIVE gate:** current trusted controller may APPLY exact verified candidate under expected-current and expected-candidate-SHA256 conditions only after a separate authorization. A web-only systemd restart is a separately enumerated owner-authorized mutation; agent/broker/PTY activation is excluded.
5. **Bounded verification:** verify exact current SHA, systemd web state, fixed loopback health and broker/agent stability. Any post-mutation failure/ambiguity preserves evidence and STOPs. No automatic retry, rollback, cleanup or alternate entrypoint.

This PR implements only **source contract and tests**, not stages 1–5 as a runnable production pipeline, not standing release authority and not an automatic post-merge deploy.

## Cross-repository boundaries and future integration

- `ops-workflows` may later offer a separately typed, full immutable-SHA pinned **native-release source/artifact workflow**, without privileged host access or reuse of the Compose executor. All production credentials, root helpers, host mutation and native release-controller code remain excluded from this public shared-policy repository.
- `RPi5_main` remains the trusted runtime boundary. A new fixed host import/activation entrypoint, allowlist or systemd change requires a separate reviewed source contract and separate exact owner LIVE gate.
- `dashboard_RPi5` keeps the full manifest, trusted current-controller, exclusive lock, fail-closed expected-current/candidate hash checks, and broker-only Docker authority.

No policy change is made to durable master #1: native deployment continues to require a separate explicit LIVE owner authorization **for every release**, even after this source-only PR merges. A future one-time activated automatic release regime would change that authority and needs its own reviewed owner decision.

## Acceptance and STOP

`npm run check:native-release-profile` must produce only `SOURCE_ONLY_PROFILE_VALID`; `npm test` covers negative drift cases. Exact-head CI and human source review are required. The PR stops at **explicit owner MERGE**. Merge is not LIVE authorization; no production, GitHub Actions deployment, secrets/permissions, Cloudflare, Docker broker or systemd mutation is included.
