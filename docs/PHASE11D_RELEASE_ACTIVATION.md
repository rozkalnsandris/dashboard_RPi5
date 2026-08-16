# Phase 11D — owner-gated release activation and rollback

Status: **source-only**.

This document does not authorize a production deployment. Issue #1 remains the owner gate for every RPi5, systemd, Cloudflare and production mutation.

## Boundary

The release controller owns exactly one production filesystem boundary:

```text
/opt/dashboard_RPi5/
  releases/<40-char-exact-source-sha>/
  current -> releases/<40-char-exact-source-sha>
```

It does not own:

- Linux users or groups;
- `/etc/dashboard-rpi5/*` environment files;
- systemd unit installation, enablement, start, stop or restart;
- Docker or journal permissions;
- Cloudflare Access, Tunnel or DNS;
- Quick Commands activation;
- terminal activation.

Those remain separate owner-authorized operations.

## Candidate requirement

A release may be planned or applied only from a candidate whose manifest was generated from the exact reviewed source SHA and whose full allowlisted contents still match that manifest.

Generate a pure JSON manifest after the production build:

```text
node tools/production-candidate-manifest.mjs \
  --root . \
  --sha <exact-source-sha> \
  > /tmp/dashboard-rpi5-candidate-<exact-source-sha>.json
```

Verify it before any release operation:

```text
node tools/production-candidate-manifest.mjs \
  --root . \
  --sha <exact-source-sha> \
  --verify /tmp/dashboard-rpi5-candidate-<exact-source-sha>.json
```

Do not capture a manifest through `npm run ... > file.json`; npm lifecycle banners can make redirected stdout non-JSON. The direct Node entrypoint above is the canonical capture path.

## Plan is the default

Without `--apply`, the controller performs validation and prints a bounded JSON plan. It does not create `/opt/dashboard_RPi5`, copy a release, or modify `current`.

```text
npm run release:production -- \
  --candidate-root . \
  --manifest /tmp/dashboard-rpi5-candidate-<sha>.json \
  --sha <sha>
```

The plan reports:

- exact source SHA;
- candidate manifest digest;
- observed current release (`none` on first activation);
- whether the target release already exists and is verified;
- bounded operation names only.

The reported current value becomes the required `--expected-current` input for any later apply. This is an optimistic-concurrency gate, not a convenience field.

## Apply — future explicit owner authorization only

**STOP. Do not run this during source preparation or merge.**

A future owner-authorized activation must provide all of:

1. the exact reviewed SHA;
2. the exact manifest;
3. `--apply`;
4. `--expected-current <sha|none>` from the reviewed plan;
5. the exact acknowledgement string:
   `I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ACTIVATION`.

Example shape only:

```text
npm run release:production -- \
  --candidate-root . \
  --manifest /tmp/dashboard-rpi5-candidate-<sha>.json \
  --sha <sha> \
  --expected-current <sha-or-none> \
  --apply \
  --ack I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ACTIVATION
```

The production CLI destination is not configurable. It is fixed by the reviewed contract to `/opt/dashboard_RPi5`.

Before copying, the candidate is reverified. Each copied file is restricted to the candidate manifest, must remain a regular non-symlink file, and is verified by byte count and SHA-256 before and after copy. The completed release is then reverified as a whole and receives a private manifest marker.

Immediately before switching `current`, the controller re-reads the current pointer. If it changed since the reviewed plan, activation blocks. The new pointer is created as a relative symlink and moved into place with a same-directory rename.

The activation operation never deletes the previous or new release.

## Partial-copy failure

If copying fails after a new release directory was created, the controller fails closed and leaves that incomplete directory in place. It does not recursively delete production data as part of error recovery.

A later attempt will see the existing but unverified target and block. Cleanup of such a partial release is a separate explicit owner action after evidence review.

## Rollback plan

Rollback only targets a release already present under `releases/<sha>` with a valid stored candidate manifest and exact content verification.

Plan first:

```text
npm run release:production -- --rollback <verified-rollback-sha>
```

The plan reports the observed current SHA and the verified rollback candidate digest.

## Rollback apply — future explicit owner authorization only

**STOP. Do not run this during source preparation or merge.**

Rollback requires:

- exact rollback SHA;
- `--expected-current <currently-reviewed-sha>`;
- `--apply`;
- acknowledgement `I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ROLLBACK`.

Example shape only:

```text
npm run release:production -- \
  --rollback <verified-rollback-sha> \
  --expected-current <currently-reviewed-sha> \
  --apply \
  --ack I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ROLLBACK
```

Rollback atomically repoints `current` only. It does not delete either release and does not restart services.

## Separate activation gates after release pointer change

A release pointer change is not a complete production launch. The following remain distinct owner-gated steps:

1. host identities/permissions and production environment preparation;
2. systemd unit installation/review;
3. service start/restart and loopback health verification;
4. Cloudflare Access creation/verification;
5. Tunnel published route creation with Protect with Access;
6. unauthenticated denial, origin JWT and authenticated smoke checks;
7. Samsung Galaxy A55 physical acceptance.

Quick Commands and the full terminal remain disabled during the base launch unless separately and explicitly authorized.

## CI test boundary

CI tests the same exported activation/rollback functions against temporary directories only. The production CLI has no arbitrary destination-root argument, and CI never writes `/opt/dashboard_RPi5`.
