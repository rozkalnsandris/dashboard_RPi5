## FAST-LANE v2.1

- **Lane:** FAST / STRICT
- **Related work:** #...
- **Runtime effect:** NONE / READ_ONLY / MUTATION
- **Deploy required:** YES / NO
- **Migration required:** YES / NO
- **Trust-boundary change:** YES / NO

## Scope

Describe one coherent acceptance story. FAST may batch 2-5 closely related same-risk work items. Keep first-time privileged capabilities isolated.

## Validation

List focused validation first, then relevant Ready validation.

## Ready receipt

Complete once when Ready:

- Base / current main:
- Exact head SHA:
- CI/checks:
- Unresolved review threads:
- Reviewed scope/diff:
- Runtime/deploy/migration classification:
- Exact next gate:

Merge is not authorized by this PR. Merge never authorizes production deployment, host/root/systemd/Docker/Cloudflare mutation, secrets, PTY/Quick Command activation, or another live write.
