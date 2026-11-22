# ADR-0009 — Native release ZIP host-import design (source-only)

**Status:** Proposed architecture/source contract, not activated. **Scope:** #309; follows accepted ADR-0008 and PR #311.

## Decision and trust boundary

Keep the root-owned, immutable current-release controller and native systemd service model. The GitHub Actions artifact is **untrusted ZIP transport**. A merged source SHA, successful CI, ZIP transport digest or self-consistent manifest **does not** grant host mutation authority, prove independently trusted build provenance, or authorize deploying candidate code. No Docker/Compose SIMPLE-DEPLOY substitution.

The source-only contract is `ops/production/native-artifact-host-import-design.json`; `tools/native-artifact-host-import-design.mjs` provides pure policy and proposed *parsed metadata* checks, exercised by negative tests. It is **not** a complete ZIP payload verifier, host importer, CLI, extractor, privileged entrypoint or executable rollout. Nothing in this PR retrieves an artifact or writes to the host.

## Incremental read-only ZIP envelope admission (source-only)

`tools/native-artifact-zip-envelope.mjs` implements only a memory-buffer structural ZIP envelope check with a caller-supplied SHA-256 transport digest and source-test fixtures. It accepts strict classic single-disk ZIPs with local/central header agreement, contiguous member offsets, sorted-size budgets, canonical candidate/receipt filenames, and Unix regular-file mode evidence. It accepts either exact local CRC/size headers or canonical **signed 16-byte data descriptors** with zeroed local fields (the 0x0008 flag), matching central CRC and sizes. It rejects ZIP64, unsigned/noncanonical descriptors, extra fields, comments, encryption, unusual compression, symlinks, directories, gaps/overlaps, duplicate members and unknown paths. These conservative limitations may reject valid GitHub artifacts until actual archive compatibility is independently established.

**This is not full ZIP or release validation.** The separate source-only `verifyNativeArtifactZipPayload` function first enforces the existing exact ZIP envelope and then checks bounded, in-memory raw-DEFLATE/stored payload lengths, complete compressed-input consumption, per-file CRC32 and SHA-256. It returns only byte-count and digest summaries, never candidate payload bytes or host files. It does **not** decode JSON, verify manifest closure/source provenance against an independently trusted SHA/digest, authenticate GitHub API metadata, download an artifact, extract to disk, perform host import, invoke trusted controller PLAN/APPLY or restart systemd. The caller-supplied digest is not independently authenticated by this function; no production suitability or LIVE authority can be inferred from its PASS result. A bounded read-only inspection of the GitHub Actions main artifact for commit `f99b6c5f481efc8cffdb8c525cbac89059724bc1` (run `44950294091`) found **82 ordinary regular-file members** with raw-deflate compression, 0x0008 data-descriptor flags and matching signed 16-byte descriptors. The ZIP transport SHA-256 matched the authenticated artifact digest. Regression tests cover that observed format with synthetic buffers; no production import or runtime check was performed. This observation does not prove any future ZIP will be compatible.

## Source-only manifest and receipt byte closure (NOT an importer)

`tools/native-artifact-manifest-closure.mjs` adds a bounded in-memory correlation step after ZIP envelope and payload CRC32/SHA-256 verification. It reads only the two length-capped JSON members, rejects noncanonical UTF-8/JSON (including duplicate keys), requires exact manifest/receipt field order and schema, exact source SHA and release path, sorted manifest paths, listed-file byte sizes and SHA-256 values, complete archive member closure, canonical manifest-core SHA-256, the independently caller-pinned candidate digest, and an untrusted Linux ARM64 receipt with `activationAuthorized=false`. Negative synthetic archive tests cover the fail-closed boundaries.

**No authentication or authority:** caller-supplied ZIP, source and candidate digests are not authenticated GitHub/API/owner evidence by this function. It cannot download, extract to a host, install, promote or activate an artifact, and does not verify trusted-controller execution. Even a PASS result is **not** approval for any RPi5 operation.

## Source-only end-to-end dry-run evidence correlation

`tools/native-artifact-dryrun-evidence.mjs` joins the existing ZIP
envelope/payload/manifest/receipt checks with strict GitHub provenance metadata
validation using the **same verified archive bytes**. It rejects archive byte
length drift against the artifact API projection, mismatched transport and
independent candidate digests, incomplete/PR workflow runs, stale main, expired
or ambiguous artifacts, and changed artifact-run links. The output is a
deterministic **source-only evidence summary**, not an extraction plan or
production permission.

**Not yet implemented:** an authenticated GitHub API collector, independent
owner-pinned candidate digest acquisition, an RPi5 host importer, staging or
trusted-controller invocation. Caller-projected metadata is not an authenticated
source by itself. A PASS cannot authorize any LIVE action.

## GitHub REST API provenance adapter (source-only)

`tools/native-artifact-github-api-projection.mjs` maps canonical GitHub REST repository, completed push-on-main workflow run, complete (bounded under 100) run-jobs listing, and complete run-artifacts listing into the existing read-only evidence verifier's inputs. It rejects foreign repository IDs, stale SHA, wrong workflow, run attempt drift, incomplete or failed required native ARM64/FAST-LANE jobs, missing or ambiguous matching artifact names, expired artifacts, and mismatched embedded workflow-run linkage. Source tests use a synthetic fixture shaped after a real read-only GitHub REST response and negative tampering cases.

**Trust limit:** projection does not make HTTP requests, authenticate GitHub, obtain artifact bytes, supply an independent candidate digest, or authorize host access. The caller must independently authenticate and bind each GitHub response to the same observed run; the existing ZIP byte correlator and owner-selected expected digest are separate checks. Refuse paginated/incomplete API lists instead of silently trusting the first page. No automatic download, import, restart or LIVE.

## Required future ingestion sequence (NOT implemented)

1. **Selection:** an operator reviews one authenticated GitHub Actions `CI` **push on `refs/heads/main`** for the exact merged 40-hex source SHA; require successful workflow, native ARM64 candidate job and FAST-LANE merge gate, matching unexpired artifact name, run ID and API-reported ZIP digest. Reject PR-produced, mutable-ref, skipped, mismatched or expired inputs. Existing 7-day artifacts are *time-limited evidence*, not stable release storage.
2. **Explicit host-import gate:** fresh exact owner authorization is required even to write an unprivileged RPi5 quarantine. The future host importer implementation, fixed target and maximum operation envelope require a separate reviewed source/host-control decision. No target directory, host agent, token, new privilege or scheduled job is defined by this design.
3. **Archive admission before write:** treat ZIP bytes, local/central-directory metadata, filenames, file types, modes, embedded JSON and all source files as hostile. A future bounded parser must verify central/local headers, offsets, lengths, encryption/unsupported features and CRC consistency, but never trust CRC as authenticity. Reject absolute, drive, UNC, backslash, empty/dot/parent paths, duplicates, overlap/aliasing, symlinks/hardlinks, devices, special files, directory records and members outside exactly two JSON files plus `candidate/` manifest-listed files. Limit compressed bytes, expanded bytes, individual bytes and entry count **before and throughout** decompression to prevent ZIP bombs. Confirm actual uploaded ZIP compatibility with this file-only policy before considering activation.
4. **Unprivileged isolated extraction:** only after the parser's complete preflight, a separately authorized importer may create a *new exclusive* bounded quarantine outside `/opt/dashboard_RPi5` and all trusted release paths. Use descriptor-relative no-follow / exclusive-create semantics; never trust archive uid/gid/modes or execute anything from ZIP. Reject existing destinations, races, hardlinks, symlinks, or changing source descriptors. Error after first host write means preserve evidence and STOP; no silent cleanup/retry.
5. **Byte-level verification:** parse strict bounded JSON with duplicate-key rejection; require exact manifest schema, fileCount, sorted unique paths, SHA-256 for every byte and canonical candidate digest (digest of the existing manifest core). Require exact expected source SHA, Linux ARM64 receipt, `UNTRUSTED_SOURCE_ONLY_NOT_DEPLOYED`, `activationAuthorized=false`, no extras or unlisted files. Compare independently owner-selected expected candidate digest, not one taken solely from the untrusted artifact. API ZIP digest is transport evidence and **not** the manifest's candidateSha256; metadata-only tests cannot prove bytes or GitHub authenticity. The current controller must independently re-read and verify all candidate bytes.
6. **Trusted read-only PLAN:** fresh owner-approved trusted-controller access must verify root-owned current release/controller, exact current SHA, lock state, all candidate bytes and `candidateSha256`; derive `observedCurrent`, `candidateSha256` and operations from the **current verified root-owned controller**, not candidate JavaScript. Unknown baseline or stale lock blocks the operation.
7. **Separate LIVE APPLY and restart:** only a new exact owner LIVE command may authorize current controller's expected-current/expected-candidate APPLY. Web service restart is separately named in the owner envelope. No automatic retry, rollback, cleanup, stage promotion, Docker authority expansion, Cloudflare, secrets, systemd, identities or permissions change. Mutation uncertainty preserves evidence and STOP.

## Required identity and authority comparison

- GitHub ZIP artifact identity: repo and numeric repository IDs, fresh exact `main` SHA, run ID/attempt, workflow **name and path**, push/ref/branch, completed-success conclusion and required checks, artifact ID/name/digest/creation/expiry, and its embedded workflow-run linkage (run ID, repo IDs, branch, exact SHA). Require exactly one matching named artifact from the complete authenticated run artifact list, reject stale/expired/future timestamps and a retention window longer than seven days. All must come from authenticated authoritative GitHub API, not a string in the ZIP. The source-only metadata validator accepts caller-projected evidence and an explicit observation timestamp; it does **not** authenticate GitHub, fetch artifacts or verify archive bytes. No artifact attestations are configured; adding `id-token`/attestation permissions requires a separate source-security decision.
- Archive members: exact `candidate-manifest.json`, `candidate-receipt.json` and regular files named `candidate/<manifest.path>`. The ZIP is not a trust root and archive mode bits are discarded. Re-created release permissions, if any future LIVE APPLY is authorized, remain fixed by the **existing** controller (directories 0755, regular files 0644, marker 0600, owner/group root). This PR changes none.
- Candidate manifest: existing `dashboard-rpi5.production-candidate.v1`; release identity remains `/opt/dashboard_RPi5/releases/<exact-source-sha>` with full release closure including agent, broker, terminal and systemd blueprints. The candidate is not a web/API-only container.
- Receipt: existing `dashboard-rpi5.native-candidate-receipt.v1`, Linux ARM64 and `activationAuthorized=false`. Cross-check its fields against independently parsed manifest and the owner-pinned SHA/digest.
- Host importer and host extraction remain **unimplemented**. Source-only ZIP header, bounded payload CRC32/SHA-256 and manifest/receipt byte-closure checks are now available; they do not authenticate a GitHub caller, establish independent build provenance, perform host preflight or grant host authorization.

## Scope and verification

Source-only: one new machine-readable design policy, a pure validator with hostile metadata tests, and documentation/test registration. No changes to current controller, production manifests, candidate build workflow, systemd, Cloudflare, Docker broker, permissions, GitHub workflow permissions, secrets, RPi5_main or LIVE runtime.

Acceptance: `npm test` covers policy drift, malformed provenance, unsafe members, excess size and metadata mismatch. Existing exact-head CI runs; review the PR diff and GitHub checks. **STOP at owner MERGE**. Even after merge, host importer and production activation remain separately gated.

## Public references

- GitHub upload-artifact security: https://github.com/actions/upload-artifact#limitations (ZIP does not preserve permission bits).
- GitHub artifact attestations: https://docs.github.com/en/actions/concepts/security/artifact-attestations (not currently authorized/enabled).
- Existing release-controller and trust requirements: `docs/PHASE11D_RELEASE_ACTIVATION.md` and `ops/production/release-activation-contract.json`.
