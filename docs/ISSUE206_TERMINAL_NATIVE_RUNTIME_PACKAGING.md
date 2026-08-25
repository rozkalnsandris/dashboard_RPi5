# Issue #206 — terminal native runtime packaging

Issue #206 closes the deferred Phase 9 `node-pty` packaging gap without activating the terminal.

## Boundary

Source-only work in this issue may make a future immutable production release contain the reviewed Linux native PTY runtime. It does **not** authorize a production deploy, release activation, systemd change, identity/group change, Cloudflare change, terminal socket activation, or PTY session.

Production terminal capability remains fail-closed and disabled until a later explicit owner-authorized activation gate.

## Why this is needed

`@dashboard-rpi5/terminal-agent` pins `node-pty@1.1.0`. The existing rollout path can explicitly source-rebuild that package, but the immutable production candidate deliberately excludes general `node_modules`. Without a packaging boundary, the built `pty.node` does not survive into the immutable release.

Upstream `node-pty@1.1.0` builds `spawn-helper` only for macOS. Linux x64/arm64 uses the compiled `build/Release/pty.node` binding directly, so `spawn-helper` is intentionally absent from this Linux contract.

## Reviewed Linux runtime allowlist

After an explicit source rebuild, staging copies exactly this subtree below `apps/terminal-agent/dist/native/node-pty`:

```text
LICENSE
package.json
lib/index.js
lib/utils.js
lib/unixTerminal.js
lib/terminal.js
lib/eventEmitter2.js
build/Release/pty.node
```

No generic `node_modules` tree is copied. `lib/interfaces.js` and `lib/types.js` are not part of the Linux execution closure and are not staged.

Every packaged regular runtime file is normalized to `0644`. Linux has no executable-mode exception.

## Fail-closed staging contract

`tools/package-terminal-native-runtime.mjs`:

- supports only Linux `x64` and `arm64`;
- requires exact `node-pty@1.1.0` package identity;
- requires explicit `build/Release/pty.node` output;
- rejects source or packaged symlinks, special files, extra packaged files, path escape, wrong package identity, missing/empty native binding and packaged executable-bit drift;
- stages only the exact reviewed allowlist;
- normalizes all staged regular files to `0644`;
- has an `--if-built` mode used only by the normal source `check` path so developer checks remain inert when no explicit native source build was requested.

The actual native binding is additionally execution-tested by the packaged PTY smoke on Linux x64 and ARM64. That smoke is the ABI/runtime proof; the filesystem validator does not duplicate ELF/Node-API loader semantics.

## Programmatic candidate verification

CLI candidate generation always requires the exact packaged runtime before manifest generation.

Programmatic `verifyProductionCandidateManifest()` also enforces terminal runtime closure whenever the production terminal-agent entrypoint `apps/terminal-agent/dist/session-stdio-entry.js` is present. A candidate with that executable entrypoint but without the exact packaged runtime is rejected.

A historical/synthetic candidate with no terminal-agent entrypoint may still be verified as a non-terminal candidate. That is fail-closed for terminal capability and preserves historical release verification/rollback compatibility.

## Runtime loader contract

Production terminal code no longer resolves bare `node-pty` from ambient `node_modules` or `NODE_PATH`. The built terminal agent loads only:

```text
./native/node-pty
```

relative to its immutable `apps/terminal-agent/dist` bundle.

The packaged-native smoke resolves that fixed module and runs one bounded `/bin/bash --noprofile --norc -c <marker>` PTY probe. CI runs it after source rebuild + staging on Linux x64 and ARM64.

## Release metadata contract

The release controller keeps the established immutable-release metadata contract:

```text
directories: 0755
regular files: 0644
manifest marker: 0600
```

There is no `spawn-helper` path and no executable-file exception for Linux terminal packaging.

## CI / rollout integration

For runtime-validation lanes, CI explicitly installs the native build toolchain, source-rebuilds exact `node-pty@1.1.0`, verifies the checkout binding, builds the terminal agent, stages the immutable runtime and executes the packaged-runtime smoke on Linux x64 and ARM64.

The production candidate manifest then hashes the staged files as ordinary immutable candidate content. Live `npm install`, live `npm rebuild`, ambient production `node_modules`, `NODE_PATH`, or any activation-time native compilation are not repair paths.

## Production classification

After merge:

```text
Production deploy: YES
```

That is classification only. Merge authorization does not authorize deploy, and deploy authorization does not authorize terminal activation.
