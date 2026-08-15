# CI Lockfile Gate

Phase 1 dependency bootstrap is complete.

A bounded one-shot branch workflow generated and committed `package-lock.json` after the direct dependency versions were pinned. That temporary write-capable workflow was removed immediately after success.

The permanent CI path is now read-only and deterministic:

```text
setup Node.js 24 + npm cache
-> npm ci --ignore-scripts
-> npm audit --audit-level=high
-> typecheck
-> lint
-> unit tests
-> production build
-> Playwright Chromium install
-> responsive browser tests
```

The repository must not return to `npm install` in normal CI unless a future, explicitly documented lockfile-bootstrap event requires it.
