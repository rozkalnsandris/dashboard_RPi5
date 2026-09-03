# Issue #243 — release-versioned PWA static cache lifecycle

This document defines the source contract for Phase 12 issue #243.

## Build identity

The production web build must inject an immutable, non-secret exact source identity into the copied `sw.js` before the build completes.

- Default identity: `git rev-parse HEAD` from the exact checked-out source.
- Packaging environments without Git metadata may set `DASHBOARD_BUILD_ID` explicitly.
- `DASHBOARD_BUILD_ID` must be the exact 40-character lowercase Git SHA; invalid or unavailable identity fails the production build closed.
- The unbuilt placeholder must never remain in the production `dist/sw.js`.

The resulting cache namespace is:

```text
dashboard-rpi5-static-<exact-build-sha>
```

A different exact source SHA therefore creates a different dashboard static-cache namespace without using secrets or mutable runtime state.

## Activation lifecycle

On service-worker activation:

1. retain the current exact-build cache;
2. delete older cache names only when they start with `dashboard-rpi5-static-`;
3. leave unrelated origin cache namespaces untouched;
4. claim clients after activation.

The service worker registration uses `updateViaCache: "none"` so worker-script freshness does not depend on HTTP cache reuse.

## Persistent-cache boundary

Only reviewed same-origin static destinations may be cached. The existing safety boundary remains unchanged:

- `/api/*` remains network-authoritative and is never persistently cached by the service worker;
- navigated dashboard documents remain network-authoritative;
- `/offline.html` is the explicit navigation fallback and contains no cached operational state;
- auth/session, logs, terminal traffic and one-time action results are not introduced into persistent PWA caches.

Service-worker install/update failure remains non-fatal to the operational UI.

## Regression expectations

Browser coverage must prove that:

- the built worker contains an exact 40-hex build identity and no placeholder;
- the active dashboard cache matches that build identity rather than a fixed `v1` namespace;
- `updateViaCache` is `none`;
- reviewed runtime static assets can be cached while `/api/*` cannot;
- re-activation removes a stale dashboard cache but preserves an unrelated origin cache;
- offline navigation still returns only the explicit non-operational fallback.

This source change does not authorize browser data clearing on user devices, Cloudflare/cache-rule mutation, deployment, service restart or any other live mutation.
