# FAST-LANE v2.1 Hybrid — dashboard_RPi5

This repository adopts the shared FAST-LANE v2.1 Hybrid model. The canonical cross-project policy is maintained in `rozkalnsandris/ops-workflows`; this file defines the dashboard-specific risk mapping.

## FAST

Typical FAST work:

- documentation and status corrections;
- UI copy/layout/source changes that do not activate a new privileged capability;
- tests and deterministic refactors;
- normal web/runtime implementation behind already-reviewed authority boundaries.

A FAST authorization may run from fresh `main` through Ready in one batch, may combine 2-5 closely related same-risk work items, and may include up to two scope-preserving corrective commits after CI/review findings.

## STRICT

Always STRICT or separately gated:

- first live host metrics/agent activation;
- Docker socket/group/engine authority;
- journal/live-log authority expansion;
- Quick Command or PTY terminal activation;
- sudo/root/systemd/service/container changes;
- production deploy;
- Cloudflare DNS/Tunnel/Access;
- secrets/credentials;
- any production write.

Source-only preparation of STRICT capability may be reviewed in Git, but activation remains a separate owner authorization.

## CI classification

The CI workflow always starts. For pull requests it classifies changed files:

- `docs_only`: Markdown/text documentation and repository guidance only;
- `terminal_native`: changes under `apps/terminal-agent/**`, `.node-version`, `package.json`, or `package-lock.json`;
- all other source changes use the existing main application validation.

Docs-only PRs skip Node dependency install, production build, Chromium/Playwright and native `node-pty` matrices. UI/source PRs keep application validation but skip native PTY matrices unless the native boundary is touched. Pushes to `main` retain full validation.

The stable aggregate status is `FAST-LANE Merge Gate`.

## Ready receipt

Record once when Ready:

- lane and related work;
- current base/main and exact head SHA;
- reviewed scope/diff;
- required CI results;
- unresolved review threads;
- deploy/trust-boundary classification;
- exact next gate.

Immediately before merge, refresh only mutable evidence. Merge remains explicit owner authority and never authorizes production deployment.
