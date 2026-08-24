# Issue #206 — terminal native runtime packaging

Issue #206 closes the deferred Phase 9 `node-pty` packaging gap without activating the terminal.

## Boundary

Source-only work in this issue may make a future immutable production release contain the reviewed Linux native PTY runtime. It does **not** authorize a production deploy, release activation, systemd change, identity/group change, Cloudflare change, terminal socket activation, or PTY session.

Production terminal capability remains fail-closed and disabled until a later explicit owner-authorized activation gate.

## Why this is needed

`@dashboard-rpi5/terminal-agent` pins `node-pty@1.1.0`. The existing rollout preflight already performs an explicit Linux source rebuild before candidate validation, but the production candidate deliberately excludes general `node_modules`. Before #206, the resulting `pty.node` and `spawn-helper` therefore did not survive into the immutable release.

The reviewed package closes that gap by staging only this Linux runtime subset below `apps/terminal-agent/dist/native/node-pty`:

```text
package.json
lib/index.js
lib/interfaces.js
lib/types.js
lib/utils.js
lib/terminal.js
lib/eventEmitter2.js
lib/unixTerminal.js
build/Release/pty.node
build/Release/spawn-helper
```

No generic `node_modules` tree is copied.

## Fail-closed staging contract

`tools/package-terminal-native-runtime.mjs`:

- supports only Linux `x64` and `arm64`;
- requires exact `node-pty@1.1.0` package identity;
- requires explicit `build/Release/pty.node` and executable `build/Release/spawn-helper` output;
- rejects source or packaged symlinks, special files, extra packaged files, path escape, wrong package identity, partial native build output and non-executable helper state;
- normalizes staged files to `0644`, except the staged helper to `0755`;
- has an `--if-built` mode used only by the normal source `check` path so developer checks remain inert when no native source build was requested.

Production candidate CLI generation/verification refuses to proceed unless that fixed packaged runtime validates.

## Runtime loader contract

Production terminal code no longer resolves bare `node-pty` from ambient `node_modules` or `NODE_PATH`. The built terminal agent loads only:

```text
./native/node-pty
```

relative to its immutable `apps/terminal-agent/dist` bundle.

The packaged-native smoke resolves that fixed module and runs one bounded `/bin/bash --noprofile --norc -c <marker>` PTY probe. CI runs the smoke after source rebuild + staging on Linux x64 and ARM64.

## Release metadata contract

The release controller continues to normalize regular immutable release files to `0644`. One exact path is the only executable exception:

```text
apps/terminal-agent/dist/native/node-pty/build/Release/spawn-helper = 0755
```

That exception is declared in `ops/production/release-activation-contract.json`, validated by the controller, applied only to the exact path, and rechecked when a release containing the helper is read back. No generic executable-mode preservation is introduced.

## CI / rollout integration

For runtime-validation lanes, CI explicitly installs the native build toolchain, source-rebuilds the exact `node-pty` package with npm lifecycle scripts allowed only for that rebuild, builds the application, stages the immutable runtime, and validates the production candidate.

The existing exact-main rollout flow already rebuilds `node-pty` before `npm run check`. The updated `check` command stages the native runtime only when that explicit build output is present, so the existing rollout candidate gains the packaged runtime without adding a second production mutation path.

## Production classification

After merge:

```text
Production deploy: YES
```

That is classification only. Merge authorization does not authorize deploy, and deploy authorization does not authorize terminal activation.
