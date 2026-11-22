# ADR-0010 — Unprivileged quarantine boundary for native GitHub artifacts

**Status:** Proposed source-only design for [issue #309](https://github.com/rozkalnsandris/dashboard_RPi5/issues/309). Owner architecture approval: `HOST-IMPORTER-QUARANTINE-DESIGN SOURCE-ONLY`. No host importer, executable entrypoint, target binding, merge, LIVE or deploy authorization.

## Decision

Preserve ADR-0008 native release-controller/systemd architecture and the ADR-0009 untrusted ZIP/manifest/receipt verification model. The next possible host ingestion is **not** release activation: it is a separately owner-approved, unprivileged, isolated quarantine import. This ADR and `ops/production/native-artifact-quarantine-design.json` only define its security boundaries. They do not create an executable importer, host path, credential, GitHub workflow, new trust privilege or release authority.

## Input and prewrite gate

1. Obtain authenticated authoritative GitHub REST metadata for a single completed successful **push on exact main** `CI` run and its completed native ARM64/FAST-LANE jobs, unique unexpired artifact, repository/run identity and SHA. Refuse incomplete listings, drift, expired/mismatched evidence and any failed GET; no automatic retry.
2. Independently select/pin the **expected candidate SHA-256** through an owner-reviewed channel separate from the untrusted ZIP/receipt. The GitHub ZIP transport SHA-256 is not this digest; a self-consistent ZIP does not authenticate itself or authorize import.
3. Before any RPi5 filesystem write, validate the full bounded ZIP envelope, member payloads (CRC32 and SHA-256), exact manifest/receipt schema, unique member closure, source SHA and independent digest. No extraction or candidate code execution during this check.
4. Revalidate source, selected artifact, the reviewed host target/baseline and the owner-authorized **single bounded import envelope** immediately before its first write. Unknown provenance, target or baseline: STOP with no write.

## Quarantine filesystem boundary — future implementation requirements

- **No path is selected by this ADR.** A later reviewed `RPi5_main` host-control contract must name the exact permitted unprivileged quarantine parent and importer identity, proven outside `/opt/dashboard_RPi5`, its immutable releases, controller, systemd directories, Docker/agent sockets and other trusted runtime paths. Never accept a browser/ZIP-supplied destination.
- Create one previously nonexistent, **exclusive** quarantine directory under that fixed parent, owned by a dedicated unprivileged identity. Refuse a pre-existing destination, symlink or ambiguous owner/mount. Proposed permissions: directories `0700`, regular files `0600`; do not copy ZIP modes, uid/gid or executable bits. No direct Docker/agent socket access.
- Extraction, if separately implemented later, requires descriptor-relative path traversal and no-follow/exclusive creation of every component, rejecting symlinks, hardlinks, devices, directories from the archive, special files, races, duplicate names and unlisted paths. Plain string-prefix checks or a sequence of unanchored pathname opens are insufficient. If the runtime cannot provide these primitives safely, **do not implement the importer as ordinary Node path operations**; use a separately reviewed trusted helper.
- Limit member count and compressed/expanded/file bytes before and during decompression; allow only manifest-listed `candidate/` regular files plus the two exact JSON members. Verify every written byte and closed-file metadata through descriptor-based checks before emitting any receipt. A quarantined receipt must state **untrusted / not activated** and contain no secrets.
- First host write consumes that import authorization. Any subsequent error, race, verification mismatch or ambiguity preserves the quarantine/evidence and **STOPs**. No retry, overwrite, rollback, automatic cleanup, implicit promotion or alternate path.

## Strict separation from production

Quarantine is only untrusted input storage and cannot automatically hand its files to privileged release code. Any trusted read-only controller PLAN requires its **own exact owner authorization** and a fresh independently verified current root-owned controller, current-production SHA, lock state, candidate file closure and expected candidate digest. A separate exact LIVE authorization is still required for controller APPLY, and any web service restart must be expressly included. The controller must not execute candidate JavaScript as root. No changes to Docker broker authority, systemd units, identities/groups, Cloudflare, secrets, repository settings, production release pointer or `RPi5_main` are approved here.

## Acceptance and non-goals

This source-only PR adds the policy, regression tests and ADR; it deliberately introduces **no callable importer** and **no selected host target**. `npm test` must fail closed on changes that silently enable writes, skip digest/provenance checks, relax extraction guarantees or grant merge/LIVE rights. Exact-head CI and manual diff review must pass before Ready; **STOP for explicit owner MERGE**. Future importer implementation, target registration, host preflight, any filesystem write and activation each require their own reviewed scope and exact owner gate.

See ADR-0008, ADR-0009, `ops/production/native-artifact-host-import-design.json`, `docs/PHASE11D_RELEASE_ACTIVATION.md`, issue #1 and `RPi5_main/docs/AUTOMATION_MASTER_PLAN.md`.
