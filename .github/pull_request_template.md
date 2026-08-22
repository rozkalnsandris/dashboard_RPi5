## FAST-LANE v2.2 Composite

- **Lane:** FAST / STRICT
- **Related work:** #...
- **Runtime effect:** NONE / READ_ONLY / MUTATION
- **Deploy required:** YES / NO
- **Migration required:** YES / NO
- **Trust-boundary change:** YES / NO
- **Composite Live required after merge:** YES / NO

## Scope

Describe one coherent acceptance story. FAST may batch 2-5 closely related same-risk work items. Keep first-time privileged capabilities isolated.

## Validation

List focused validation first, then relevant exact-head Ready validation. Read-only CI/review/evidence work is not an owner gate.

## Ready receipt

Complete once when Ready:

- Base / current main:
- Exact head SHA:
- CI/checks:
- Unresolved review threads:
- Reviewed scope/diff:
- Runtime/deploy/migration/trust-boundary classification:
- Composite Live required: YES / NO
- Exact next owner decision:

## Composite Live envelope — only when required

Before requesting live authorization, bind the exact approved SHA/ref and target, allowed mutation categories, practical limits, explicit exclusions, and expected pre-mutation baseline. Prefer one fail-closed one-shot through final reconciliation. After the first authorized mutation starts, error/ambiguity means evidence + STOP; no automatic retry/rollback/cleanup unless explicitly pre-authorized.

Merge is not authorized by this PR. Merge never authorizes production deployment, host/root/systemd/Docker/Cloudflare mutation, secrets, PTY/Quick Command activation, or another live write.
