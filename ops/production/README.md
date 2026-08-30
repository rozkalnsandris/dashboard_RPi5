# Production launch source boundary

This directory is source-only. Nothing here authorizes host, systemd, Cloudflare, user/group, socket-permission or deployment mutation.

Canonical files:

- `launch-contract.json` — machine-readable identities, paths and capability defaults;
- `web.env.example` — base production environment with terminal disabled;
- `terminal.env.example` — future owner-gated terminal activation inputs; intentionally incomplete/fail-closed;
- `smoke-contract.json` — machine-readable future post-deploy acceptance baseline;
- `cloudflare-contract.json` — exact `dash.rozkalns.net` Access/Tunnel/loopback edge contract;
- `cloudflare.env.example` — placeholder-only out-of-repo activation binding names; never production values;
- `release-activation-contract.json` — exact immutable release/current-pointer, exclusive apply lock, reviewed-candidate binding and owner acknowledgement boundary;
- `host-readiness-contract.json` — fixed read-only RPi5 pre-bootstrap evidence contract.

The web service environment contract is ordered and fail-closed:

1. `/etc/dashboard-rpi5/web.env` is mandatory and keeps `DASHBOARD_TERMINAL_ENABLED=disabled` in the base production environment;
2. `/etc/dashboard-rpi5/terminal.env` is an optional systemd overlay loaded after the base file, so its absence leaves the terminal disabled;
3. the checked-in `terminal.env.example` deliberately enables the feature while leaving all required Cloudflare Access owner-auth values empty. The server rejects that incomplete enabled configuration at startup rather than admitting terminal sessions.

Source wiring of the optional overlay does not authorize creating `/etc/dashboard-rpi5/terminal.env`, changing systemd state, granting `dashboard-rpi5-terminal-client` membership, configuring Cloudflare Access, or activating the terminal. Those remain separate explicit owner-gated production/trust-boundary changes. No production Access values belong in GitHub.

Read-only candidate validation for an already-staged release:

```text
npm run preflight:production -- --release /opt/dashboard_RPi5/releases/<sha> --sha <sha>
```

Read-only Cloudflare launch contract validation:

```text
npm run preflight:cloudflare -- \
  --contract ops/production/cloudflare-contract.json \
  --launch ops/production/launch-contract.json
```

A separately prepared activation env file outside GitHub can be syntax-validated by adding `--env <path>`. The verifier does not contact Cloudflare and does not reflect binding values in its PASS output.

Read-only first-bootstrap host readiness evidence on the actual RPi5:

```text
npm run preflight:host
```

The host verifier accepts no CLI path overrides. It reads only fixed local evidence from `/etc`, `/proc`, `/run`, fixed production/socket paths and the checked-in systemd unit blueprints. It performs no process execution, network access or filesystem mutation. `READY` means the observed host is compatible with the reviewed bootstrap contract; it is not deployment authorization.

Deterministic build candidate manifest:

```text
npm run manifest:production -- --root . --sha <exact-source-sha>
```

The manifest hashes only explicit production roots, including the Cloudflare launch contract, release activation contract/controller and host-readiness contract/verifier, rejects symlinks/non-regular files, records per-file SHA-256 evidence and derives the intended immutable release path from the exact source SHA.

## Release-controller trust boundary

Candidate bytes and privileged controller code are separate trust domains.

An operator-owned **candidate checkout is untrusted by root**. Future production PLAN/APPLY/ROLLBACK must never execute `tools/production-release-controller.mjs` from that checkout with `sudo`/root authority.

Once this hardening is established on the host, the production controller entrypoint is the controller inside the currently active, fully verified, **root-owned immutable release**:

```text
/opt/dashboard_RPi5/releases/<reviewed-current-sha>/tools/production-release-controller.mjs
```

Production PLAN uses that trusted controller, even though PLAN itself remains filesystem non-mutating:

```text
sudo /usr/bin/node \
  /opt/dashboard_RPi5/releases/<reviewed-current-sha>/tools/production-release-controller.mjs \
  --candidate-root <operator-candidate-root> \
  --manifest <candidate-manifest.json> \
  --sha <exact-source-sha>
```

The trusted PLAN descriptor-safely reads the candidate manifest and every manifest-listed candidate file, then reports both:

- `observedCurrent`, which becomes apply-time `--expected-current`; and
- `candidateSha256`, which becomes apply-time `--expected-candidate`.

A future owner-authorized APPLY has this shape:

```text
sudo /usr/bin/node \
  /opt/dashboard_RPi5/releases/<reviewed-current-sha>/tools/production-release-controller.mjs \
  --candidate-root <operator-candidate-root> \
  --manifest <candidate-manifest.json> \
  --sha <exact-source-sha> \
  --expected-current <reviewed-current-sha-or-none> \
  --expected-candidate <candidateSha256-from-plan> \
  --apply \
  --ack I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ACTIVATION
```

The controller rejects a production operation unless its own real path is inside the current verified release, its release/controller metadata is `root:root` with the reviewed modes, and the current pointer still identifies that release. Its release activation contract is loaded relative to that trusted module rather than the caller's working directory.

During privileged candidate inspection/copy, the controller does not validate a pathname and then reopen it later. On Linux it pins every candidate directory component through open directory descriptors, opens the final file with no-symlink semantics, validates it with descriptor-backed `stat`, and hashes the same descriptor bytes used by the operation. During APPLY the destination is created exclusively as `0600`; only exact byte-count and SHA-256 PASS allows promotion to the normal root-owned `0644` release-file metadata. A mismatch therefore leaves at most private incomplete evidence and never publishes unverified bytes as a normal release file.

The complete root-owned release is still reverified against the production manifest before the private manifest marker is written or `current` can move. Existing path containment, exact source SHA, immutable release directory, no-delete and atomic relative `current` swap semantics remain unchanged.

The production CLI destination is fixed to `/opt/dashboard_RPi5`. APPLY/ROLLBACK serialize through an exclusive lock under the production root; a pre-existing lock blocks. Merge or `turpini` does not authorize any production operation.

### First hardened-controller bootstrap

A host whose current verified release predates #236 cannot safely gain the new boundary by running the new JavaScript directly from a candidate checkout. The first adoption therefore requires a separately reviewed and explicitly owner-authorized bootstrap/reconciliation that establishes the exact reviewed hardened controller as root-owned immutable trusted code before it is used with root authority. This source issue does not authorize or perform that bootstrap.

Do not work around this gate with `sudo /usr/bin/node ./tools/production-release-controller.mjs`, a writable symlink/path indirection, or controller bytes whose exact reviewed provenance is not established.

Phase 11B rollout/rollback and candidate integrity are documented in `docs/PHASE11B_PRODUCTION_CANDIDATE.md`.

Phase 11C Access/Tunnel ordering, owner binding model and edge rollback boundary are documented in `docs/PHASE11C_CLOUDFLARE_LAUNCH.md`.

Phase 11D exact-SHA release activation, atomic current-pointer swap and rollback behavior are documented in `docs/PHASE11D_RELEASE_ACTIVATION.md`.

Phase 11E actual-host pre-bootstrap evidence and fail-closed readiness semantics are documented in `docs/PHASE11E_HOST_READINESS.md`.

The preflight tools and source changes do not activate production. Any production filesystem apply, trusted-controller bootstrap, systemd, host-permission or Cloudflare change still requires a separate explicit owner authorization under issue #1.
