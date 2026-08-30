# Phase 11D — owner-gated release activation and rollback

Status: **source-only**.

This document does not authorize a production deployment. Issue #1 remains the owner gate for every RPi5, systemd, Cloudflare and production mutation.

## Boundary

The release controller owns exactly one production filesystem boundary:

```text
/opt/dashboard_RPi5/
  .dashboard-release-controller.lock
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

The production root and `releases` root must be real directories. The controller refuses symlinks at those trust boundaries instead of following them.

## Candidate requirement

A release may be planned or applied only from a candidate whose manifest was generated from the exact reviewed source SHA and whose allowlisted bytes match that manifest.

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

The operator-owned **candidate checkout is not a trusted root execution location**. Candidate bytes are evidence inputs only; they are never privileged executable authority.

## Plan is the default and runs unprivileged

Without `--apply`, the controller performs validation and prints a bounded JSON plan. It does not create `/opt/dashboard_RPi5`, acquire an apply lock, copy a release, or modify `current`.

Run candidate planning from the checkout without `sudo`/root:

```text
node tools/production-release-controller.mjs \
  --candidate-root . \
  --manifest /tmp/dashboard-rpi5-candidate-<sha>.json \
  --sha <sha>
```

The plan reports:

- exact source SHA;
- candidate manifest digest as `candidateSha256`;
- observed current release (`none` on first activation);
- whether the target release already exists and is verified;
- bounded operation names only.

Both reviewed plan values are apply gates:

```text
observedCurrent  -> --expected-current
candidateSha256 -> --expected-candidate
```

`--expected-current` prevents pointer drift between plan and apply. `--expected-candidate` prevents a different valid manifest/candidate from being substituted after the owner reviewed the plan.

A production candidate plan is intentionally rejected when invoked as root. Root authority is unnecessary for candidate validation and would turn candidate path traversal into privileged read authority.

## Privileged controller execution boundary

**STOP. Do not run production apply during source preparation or merge.**

A production apply or rollback must execute the controller from the currently active, fully verified, root-owned immutable release:

```text
/opt/dashboard_RPi5/releases/<current-reviewed-sha>/tools/production-release-controller.mjs
```

The production gate verifies before apply:

- EUID is root;
- the controller's real path is exactly under `releases/<40-hex-sha>/tools/production-release-controller.mjs`;
- that release directory is a real `root:root 0755` directory;
- the controller is a real `root:root 0644` file;
- the controller's release is exactly the current release;
- the current release still passes its stored manifest verification.

The controller also loads `ops/production/release-activation-contract.json` relative to its own trusted immutable release, not relative to the caller's working directory.

A candidate checkout must therefore never be used as the privileged entrypoint. In particular, this form is forbidden for future production apply:

```text
sudo /usr/bin/node ./tools/production-release-controller.mjs ...
```

## Descriptor-safe candidate consumption

The privileged installer does not use a `lstat(path) -> later open/copy(path)` sequence for candidate files.

On the Linux/RPi5 production path it instead:

1. opens `/` and traverses every candidate-root and manifest-entry directory component through `/proc/self/fd/<directory-fd>/<child>`;
2. opens each directory with `O_DIRECTORY | O_NOFOLLOW` and keeps the next directory pinned by descriptor before closing its parent descriptor;
3. opens the final candidate file with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`;
4. validates the opened object with descriptor-backed `stat` and requires an exact-size regular file;
5. creates the destination with exclusive create semantics and mode `0600`;
6. reads, hashes and copies bytes from the **same opened source descriptor**;
7. requires exact byte count and SHA-256 before considering the copy verified;
8. leaves a failed/incomplete destination private at `0600` rather than promoting unverified bytes;
9. only after descriptor verification succeeds normalizes the installed file to the reviewed `root:root 0644` metadata;
10. reverifies the destination and then the complete root-owned release tree before writing the private manifest marker or moving `current`.

Renaming or replacing the candidate pathname after the source file has been opened cannot redirect the active copy to a different inode. A symlink in the final source or any traversed candidate directory component fails closed.

The full candidate manifest used by privileged apply is also opened through the descriptor-safe no-symlink path and is bound to the `--expected-candidate` SHA-256 from the reviewed unprivileged plan.

## Apply — future explicit owner authorization only

A future owner-authorized activation must provide all of:

1. the exact reviewed SHA;
2. the exact candidate manifest;
3. the exact current trusted release/controller path;
4. `--apply`;
5. `--expected-current <sha|none>` from the reviewed plan;
6. `--expected-candidate <candidateSha256>` from the reviewed plan;
7. the exact acknowledgement string `I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ACTIVATION`.

Example shape only:

```text
sudo /usr/bin/node \
  /opt/dashboard_RPi5/releases/<current-reviewed-sha>/tools/production-release-controller.mjs \
  --candidate-root <operator-candidate-root> \
  --manifest /tmp/dashboard-rpi5-candidate-<sha>.json \
  --sha <sha> \
  --expected-current <sha-or-none> \
  --expected-candidate <candidateSha256-from-plan> \
  --apply \
  --ack I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ACTIVATION
```

The production destination is not configurable. It is fixed by the reviewed contract to `/opt/dashboard_RPi5`.

Before any apply lock or release write, the trusted controller validates the reviewed candidate-manifest binding read-only. Apply then acquires `/opt/dashboard_RPi5/.dashboard-release-controller.lock` with exclusive create semantics and repeats the binding/current checks while holding that lock. A second activation or rollback cannot run concurrently through this controller.

A pre-existing lock is fail-closed. The controller does not infer whether it is stale and does not auto-delete it. A leftover lock after a crash requires separate owner evidence review and explicit cleanup before any retry.

Immediately before switching `current`, the controller re-reads the current pointer while still holding the exclusive apply lock. If it changed since the reviewed plan, activation blocks. The new pointer is created as a relative symlink and moved into place with a same-directory rename.

The activation operation never deletes the previous or new release.

## First descriptor-safe controller bootstrap

The #236 trust boundary creates an intentional chicken-and-egg gate for a host whose current verified release predates this hardened controller: the new candidate controller is not allowed to gain root authority merely because its source is ready.

The first production adoption of this hardening therefore needs a **separate explicit owner-authorized bootstrap/reconciliation** that establishes the exact reviewed hardened controller as root-owned immutable trusted code before privileged apply is attempted. That bootstrap is a live/root mutation and is not authorized by this source issue, a merge, `turpini`, or a read-only preflight.

Do not bypass the bootstrap gate by running the controller directly from a candidate checkout, by using an operator-writable symlink, or by copying an unverified controller into a privileged path.

After a hardened release is current, later releases use that current verified controller as the privileged entrypoint.

## Partial-copy failure

If copying fails after a new release directory or destination file was created, the controller fails closed and leaves that incomplete evidence in place. It does not recursively delete production data as part of error recovery. A candidate file that fails descriptor/hash verification is not promoted to normal `0644` release metadata.

A later attempt will see the existing but unverified target and block. Cleanup of such a partial release is a separate explicit owner action after evidence review.

The current handled-error lock cleanup behavior remains unchanged in this issue; the separate post-mutation evidence/lock semantics are tracked in issue #238. Do not fold #238 into #236.

## Rollback plan

Rollback only targets a release already present under `releases/<sha>` with a valid stored candidate manifest and exact content verification.

Plan first:

```text
node tools/production-release-controller.mjs --rollback <verified-rollback-sha>
```

The plan reports the observed current SHA and the verified rollback candidate digest. Rollback planning is read-only and does not acquire the apply lock.

## Rollback apply — future explicit owner authorization only

Rollback requires:

- execution from the current verified root-owned release controller;
- exact rollback SHA;
- `--expected-current <currently-reviewed-sha>`;
- `--apply`;
- acknowledgement `I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ROLLBACK`.

Example shape only:

```text
sudo /usr/bin/node \
  /opt/dashboard_RPi5/releases/<current-reviewed-sha>/tools/production-release-controller.mjs \
  --rollback <verified-rollback-sha> \
  --expected-current <currently-reviewed-sha> \
  --apply \
  --ack I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ROLLBACK
```

Rollback acquires the same exclusive apply lock, revalidates the current and rollback releases while holding it, then atomically repoints `current` only. It does not delete either release and does not restart services.

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

CI tests descriptor pinning, symlink rejection, same-inode tamper detection, private pre-verification destination mode and the existing activation/rollback functions against temporary directories only. The production CLI has no arbitrary destination-root argument, and CI never writes `/opt/dashboard_RPi5`.
