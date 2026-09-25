# Controller transition v1

This source-only recovery contract closes the controller-closure gap between the reviewed legacy bridge release and the current full production candidate closure. It does not authorize any production or RPi5 mutation.

## Why this profile exists

The trusted bridge controller from source `bc4cc9f1d49b97d8c5df65158640c4e3df3e7769` reconstructs a fixed 33-file-root default production closure. Current source added `ops/production/controller-bootstrap-provenance-contract.json` to the normal/full closure, so a current full manifest cannot be verified by that bridge controller.

`controller-transition-v1` is intentionally frozen to the exact 33 file roots expected by the trusted bridge controller. It is not defined as a dynamic subtraction from the current full profile; future full-root growth must not silently change this compatibility profile.

## Immutable three-stage sequence

1. `controller-bootstrap-v1`: a reviewed merged-PR exact head whose tree equals its squash-merge main commit establishes the bridge controller.
2. `controller-transition-v1`: a later reviewed merged-PR exact head, with successful exact-head CI and tree equality to its squash-merge main commit, emits the exact 33-root closure accepted by the bridge controller while installing the newer manifest/controller tooling.
3. `full`: after the transition release is current and trusted, use the corresponding freshly revalidated squash-merge current-main SHA with the normal full profile. The full SHA must differ from both bridge and transition SHAs.

The transition and full candidates may be tree-equivalent but must use distinct commit SHAs so immutable release directories remain distinct. Never expand a transition release in place or reuse its SHA for the full closure.

## Trust boundary

Generate the transition manifest from the non-root candidate checkout:

```text
npm run manifest:production -- --root . --sha <merged-pr-exact-head-sha> --profile controller-transition-v1
```

PLAN/APPLY still execute only the production release controller from the currently trusted root-owned immutable release. The trusted bridge controller receives the transition manifest with no profile metadata and reconstructs its own default 33-root closure; manifest equality, per-file digests, descriptor safety and current-controller trust checks remain unchanged.

After a successful transition activation, a separate full candidate and separate LIVE authorization are still required. This profile does not authorize release apply, service restart, exporter/Prometheus/firewall/Docker/permission/Cloudflare changes, terminal activation, rollback or cleanup.
