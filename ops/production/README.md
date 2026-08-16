# Production launch source boundary

This directory is source-only. Nothing here authorizes host, systemd, Cloudflare, user/group, socket-permission or deployment mutation.

Canonical files:

- `launch-contract.json` — machine-readable identities, paths and capability defaults;
- `web.env.example` — base production environment with terminal disabled;
- `terminal.env.example` — future owner-gated terminal activation inputs; intentionally incomplete/fail-closed;
- `smoke-contract.json` — machine-readable future post-deploy acceptance baseline;
- `cloudflare-contract.json` — exact `dash.rozkalns.net` Access/Tunnel/loopback edge contract;
- `cloudflare.env.example` — placeholder-only out-of-repo activation binding names; never production values;
- `release-activation-contract.json` — exact immutable release/current-pointer and owner acknowledgement boundary.

Read-only candidate validation for an already-staged release:

```text
npm run preflight:production -- --release /opt/dashboard_RPi5/releases/<sha> --sha <sha>
```

Read-only Cloudflare launch contract validation:

```text
npm run preflight:cloudflare -- \
  --contract ops/production/cloudflare-contract.json \
  --launch ops/production/launch-contract.json
```

A separately prepared activation env file outside GitHub can be syntax-validated by adding `--env <path>`. The verifier does not contact Cloudflare and does not reflect binding values in its PASS output.

Deterministic build candidate manifest:

```text
npm run manifest:production -- --root . --sha <exact-source-sha>
```

The manifest hashes only explicit production roots, including the Cloudflare launch contract, release activation contract and release controller source, rejects symlinks/non-regular files, records per-file SHA-256 evidence and derives the intended immutable release path from the exact source SHA.

Release activation is plan-only by default:

```text
npm run release:production -- \
  --candidate-root . \
  --manifest <candidate-manifest.json> \
  --sha <exact-source-sha>
```

The production CLI destination is fixed to `/opt/dashboard_RPi5`. A filesystem-changing apply additionally requires the reviewed current SHA (or `none`), `--apply`, and the exact owner acknowledgement string defined in `release-activation-contract.json`. Merge or `turpini` does not authorize apply.

Phase 11B rollout/rollback and candidate integrity are documented in `docs/PHASE11B_PRODUCTION_CANDIDATE.md`.

Phase 11C Access/Tunnel ordering, owner binding model and edge rollback boundary are documented in `docs/PHASE11C_CLOUDFLARE_LAUNCH.md`.

Phase 11D exact-SHA release activation, atomic current-pointer swap and rollback behavior are documented in `docs/PHASE11D_RELEASE_ACTIVATION.md`.

The preflight tools and default release plan do not activate production. Any production filesystem apply, systemd, host-permission or Cloudflare change still requires a separate explicit owner authorization under issue #1.
