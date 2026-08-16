# Production launch source boundary

This directory is source-only. Nothing here authorizes host, systemd, Cloudflare, user/group, socket-permission or deployment mutation.

Canonical files:

- `launch-contract.json` — machine-readable identities, paths and capability defaults;
- `web.env.example` — base production environment with terminal disabled;
- `terminal.env.example` — future owner-gated terminal activation inputs; intentionally incomplete/fail-closed;
- `smoke-contract.json` — machine-readable future post-deploy acceptance baseline.

Read-only candidate validation for an already-staged release:

```text
npm run preflight:production -- --release /opt/dashboard_RPi5/releases/<sha> --sha <sha>
```

Deterministic build candidate manifest:

```text
npm run manifest:production -- --root . --sha <exact-source-sha>
```

The manifest hashes only explicit production roots, rejects symlinks/non-regular files, records per-file SHA-256 evidence and derives the intended immutable release path from the exact source SHA.

Phase 11B rollout/rollback and Cloudflare ordering are documented in `docs/PHASE11B_PRODUCTION_CANDIDATE.md`.

The preflight and manifest tools do not activate production. Any production, systemd, host-permission or Cloudflare change still requires a separate explicit owner authorization under issue #1.
