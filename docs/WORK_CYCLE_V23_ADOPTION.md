# FAST-LANE v2.3 adoption — dashboard_RPi5

Status: source/governance consumer adapter for `ops-workflows#124`.

Canonical shared revision: `rozkalnsandris/ops-workflows@274d58f2d9d3cb86feded2751b8f9009a4501f6b`.

## Adopted capabilities

- `BOOTSTRAP_MANIFEST_V1` through `.github/agent-bootstrap.json`.
- START safe auto-continuation and compact terminal response semantics through the existing Agent Work Cycle/FAST rules.
- `WRITE_PREFLIGHT_COMPACT_V1` through `.github/github-api-access-v1.json`; no second local preflight framework.

The bootstrap manifest is routing metadata only. It contains no mutable branch/PR/CI/review/runtime truth and grants no authority.

## AUTO-RUN FULL applicability

`dashboard_RPi5` does not currently provide a repository-local AUTO-RUN FULL contract or controller. For this rollout:

```text
AUTO_RUN_FULL = NOT_APPLICABLE
```

No controller is created merely for fleet uniformity. A future FULL adoption would require its own explicit repository-local governance decision.

## Deployment profile and local stricter rules

The deployment profile is `custom` because dashboard production deployment and trust-boundary mutations are governed by repository-specific owner gates. This rollout does not activate SIMPLE-DEPLOY and does not change the production delivery model.

`AGENTS.md` remains authoritative, including:

- explicit owner squash merge;
- separate production deploy authorization;
- separate Cloudflare, Docker, systemd, host/root, secrets/credentials, permissions/identity and write-capability gates;
- issue #1 as the canonical product contract;
- fail-closed execution after a started mutation errors or becomes ambiguous.

Merge never implies LIVE or deploy.

## Authority

This adoption does not widen source, merge, LIVE/runtime, production-data, credentials, permissions, retry, rollback, cleanup, Queue or deployment authority. Queue vNext is not activated.
