# CI Bootstrap Gate

The first Phase 1 CI run intentionally precedes the committed npm lockfile. Until `package-lock.json` is captured from the GitHub runner and committed, CI is bootstrap-only and the PR must remain Draft.

The temporary bootstrap workflow must not use setup-node npm caching because that cache mode requires an existing dependency lockfile. After the lockfile is committed, CI switches to `npm ci` and npm caching may be enabled.
