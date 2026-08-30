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

It does not own Linux users/groups, `/etc/dashboard-rpi5/*`, systemd service mutation, Docker/journal permission changes, Cloudflare state, Quick Commands activation or terminal activation. Those remain separate owner-authorized operations.

The production root and `releases` root must be real directories. The controller refuses symlinks at those trust boundaries instead of following them.

## Candidate requirement

A release may be planned or applied only from a candidate whose manifest was generated from the exact reviewed source SHA and whose allowlisted bytes match that manifest.

Generate and verify a pure JSON candidate manifest after the production build:

```text
node tools/production-candidate-manifest.mjs \
  --root . \
  --sha <exact-source-sha> \
  > /tmp/dashboard-rpi5-candidate-<exact-source-sha>.json

node tools/production-candidate-manifest.mjs \
  --root . \
  --sha <exact-source-sha> \
  --verify /tmp/dashboard-rpi5-candidate-<exact-source-sha>.json
```

Do not capture a manifest through `npm run ... > file.json`; npm lifecycle banners can make redirected stdout non-JSON.

The operator-owned **candidate checkout is data, not privileged executable authority**. A production PLAN/APPLY/ROLLBACK must not run controller JavaScript from that checkout under root.

## Trusted production controller

After #236 is established on the host, the only reviewed production controller entrypoint is the controller in the currently active, fully verified, root-owned immutable release:

```text
/opt/dashboard_RPi5/releases/<current-reviewed-sha>/tools/production-release-controller.mjs
```

Before a production PLAN/APPLY/ROLLBACK the controller verifies:

- EUID is root;
- its real path has exactly the reviewed `releases/<40-hex-sha>/tools/production-release-controller.mjs` shape;
- the containing release is a real `root:root 0755` directory;
- the controller is a real `root:root 0644` file;
- that release is exactly the current release;
- the current release still passes its stored manifest verification.

The release activation contract is loaded relative to the trusted controller module, not from the caller's working directory.

The historical pattern below is forbidden for future production operations because it executes operator-writable candidate code as root:

```text
sudo /usr/bin/node ./tools/production-release-controller.mjs ...
```

## Production PLAN — read-only, trusted code

PLAN remains filesystem non-mutating, but it runs through the trusted current controller so the private root-owned installed manifest can be verified without granting candidate code root authority.

```text
sudo /usr/bin/node \
  /opt/dashboard_RPi5/releases/<current-reviewed-sha>/tools/production-release-controller.mjs \
  --candidate-root <operator-candidate-root> \
  --manifest /tmp/dashboard-rpi5-candidate-<sha>.json \
  --sha <sha>
```

PLAN descriptor-safely verifies the candidate manifest and every manifest-listed source file. It reports:

- exact source SHA;
- `candidateSha256`;
- observed current release;
- whether the target release already exists and is verified;
- bounded operation names only.

The reviewed values become apply gates:

```text
observedCurrent  -> --expected-current
candidateSha256 -> --expected-candidate
```

`--expected-current` prevents current-pointer drift. `--expected-candidate` prevents a different valid manifest/candidate from being substituted after PLAN review.

## Descriptor-safe candidate consumption

The trusted controller does not use `lstat(path) -> later open/copy(path)` for candidate inputs.

On Linux/RPi5 it:

1. opens `/` and traverses candidate-root/manifest parent components through `/proc/self/fd/<directory-fd>/<child>`;
2. opens directories with `O_DIRECTORY | O_NOFOLLOW`, pinning each next directory by descriptor;
3. opens final candidate files with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`;
4. requires descriptor-backed `stat` to report a regular file with the exact expected size;
5. hashes candidate bytes from that same open descriptor during PLAN and pre-APPLY verification;
6. during APPLY creates each destination with exclusive create semantics and mode `0600`;
7. hashes the exact source-descriptor bytes being copied and requires exact byte count + SHA-256;
8. only after PASS changes the installed destination to reviewed `root:root 0644` metadata;
9. reverifies the installed file and complete root-owned release before writing the private manifest marker or moving `current`.

Renaming or replacing a candidate pathname after the file is opened cannot redirect the active read/copy to another inode. Final-component or parent-directory symlinks fail closed. A digest/size mismatch leaves at most private `0600` incomplete evidence and does not promote unverified bytes as a normal release file.

## APPLY — future explicit owner authorization only

**STOP. Do not run this during source preparation or merge.**

A future activation requires all of:

1. exact reviewed source SHA;
2. exact reviewed candidate manifest;
3. exact trusted current controller path;
4. `--expected-current <sha|none>` from PLAN;
5. `--expected-candidate <candidateSha256>` from PLAN;
6. `--apply`;
7. acknowledgement `I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ACTIVATION`.

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

The production destination is fixed to `/opt/dashboard_RPi5`.

Before any apply lock or release write, the trusted controller repeats candidate/current validation. APPLY then acquires `/opt/dashboard_RPi5/.dashboard-release-controller.lock` with exclusive create semantics and repeats the binding/current checks while holding that lock. A second activation or rollback cannot run concurrently through this controller.

A pre-existing lock is fail-closed. The controller does not infer whether it is stale and does not auto-delete a pre-existing lock.

Immediately before switching `current`, the controller re-reads the current pointer while holding the lock. If it changed since PLAN, activation blocks. The new pointer is a relative symlink moved into place with a same-directory rename. Activation never deletes previous or new releases.

## First descriptor-safe controller bootstrap

The #236 boundary intentionally creates a bootstrap gate for a host whose current verified release predates the hardened controller. The new candidate controller is not permitted to become root-authoritative merely because source is merged.

The first production adoption therefore requires a **separate explicit owner-authorized bootstrap/reconciliation** that establishes the exact reviewed hardened controller as root-owned immutable trusted code before production PLAN/APPLY/ROLLBACK uses it. That is a live/root mutation and is not authorized by this issue, merge, `turpini`, or read-only evidence collection.

Do not bypass this gate by running candidate-checkout JavaScript under `sudo`, by using an operator-writable symlink, or by copying controller bytes without exact reviewed provenance.

After a hardened release is current, future operations use that current verified controller.

## Partial-copy failure

If copying fails after a release directory or destination file is created, the controller leaves that incomplete evidence in place and does not recursively delete production data. A source that fails descriptor/hash verification is not promoted to `0644` release metadata.

A later attempt sees the existing but unverified target and blocks. Cleanup is a separate explicit owner action after evidence review.

The handled-error apply-lock cleanup behavior is intentionally unchanged in #236; post-mutation evidence/lock semantics are tracked separately in #238.

## Rollback

Rollback only targets an already installed release with a valid stored candidate manifest and exact content verification.

Production rollback PLAN/APPLY must also execute through the current verified root-owned controller. Apply requires exact rollback SHA, `--expected-current`, `--apply` and acknowledgement `I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ROLLBACK`.

Example apply shape only:

```text
sudo /usr/bin/node \
  /opt/dashboard_RPi5/releases/<current-reviewed-sha>/tools/production-release-controller.mjs \
  --rollback <verified-rollback-sha> \
  --expected-current <currently-reviewed-sha> \
  --apply \
  --ack I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ROLLBACK
```

Rollback uses the same exclusive lock, revalidates current/rollback releases and atomically repoints `current` only. It does not delete releases or restart services.

## Separate gates after a release pointer change

A release pointer change is not a complete production launch. Host identities/permissions, production environment, systemd installation/restarts, Cloudflare Access/Tunnel, authenticated smoke checks and Samsung Galaxy A55 physical acceptance remain separately owner-gated. Quick Commands and full terminal also remain separately gated.

## CI test boundary

CI exercises descriptor pinning, parent/final symlink rejection, same-inode tamper detection, private pre-verification destination mode and existing activation/rollback functions against temporary directories only. The production CLI has no arbitrary destination-root argument, and CI never writes `/opt/dashboard_RPi5`.
