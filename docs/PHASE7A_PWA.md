# Phase 7A — PWA foundation

Issue: #38  
Master contract: #1

## Scope

Phase 7A makes the dashboard source installable as a standalone PWA while preserving the dashboard's evidence rule: missing or stale operational data must never look current.

This phase is source-only. It does not deploy or activate anything on `dash.rozkalns.net`.

## Manifest

`apps/web/public/manifest.webmanifest` fixes the application identity and scope to `/` and declares:

- `display: standalone`;
- dark theme/background;
- raster 192×192 PNG fallback;
- raster 512×512 PNG fallback;
- separate raster 512×512 `maskable` PNG;
- an optional 512×512 SVG icon for Chromium-class vector support.

The document link uses `crossorigin="use-credentials"` so an installed browser/PWA fetch keeps credentials attached when the protected dashboard is fronted by Cloudflare Access. The manifest itself remains same-origin and the CSP keeps `manifest-src 'self'`; the application does not widen manifest trust to the Access login hostname.

The raster fallbacks are deliberate: Chromium supports SVG manifest icons, but current Google guidance recommends a raster fallback for browsers that do not support SVG manifest icons consistently.

The important `R5` mark stays in the center of the maskable asset so platform masks may remove outer decoration without removing the identity mark.

## Service-worker boundary

`apps/web/public/sw.js` is first-party and intentionally narrow.

### Persistent cache may contain only

- the dedicated `offline.html` fallback;
- the manifest and reviewed raster icon assets;
- same-origin requests whose browser destination is `script`, `style`, `font`, or `image`.

Successful Vite JS/CSS assets are content-hashed, so cache-first reuse does not make operational evidence stale.

### Persistent cache must never contain

- `/api/*` responses;
- navigated dashboard HTML;
- log payloads;
- terminal/session payloads;
- authorization/session data;
- arbitrary cross-origin responses;
- one-time action results.

`/api/*` is not intercepted by the service worker and remains network-authoritative.

Navigation requests are network-first. If navigation fails, the worker returns only `offline.html`; successful dashboard documents are never inserted into Cache Storage. The offline document explicitly says it contains no cached operational state.

## Browser state

The React shell listens to browser `online` / `offline` events. Offline mode renders a visible status banner stating that live operational data is unavailable and is not treated as current.

Service-worker registration is attempted only in production builds, only when service workers are supported, and only in a secure context. Registration failure does not block the dashboard UI.

## Mobile / standalone

Existing safe-area variables remain authoritative. `@media (display-mode: standalone)` adds small standalone-mode padding/min-height adjustments without user-agent or Samsung-model sniffing.

The viewport contract remains zoomable and keeps `viewport-fit=cover` plus `interactive-widget=resizes-content`.

## Validation

Browser coverage verifies:

- manifest link, credential mode and identity;
- raster 192/512 and maskable PNG entries;
- all declared icon resources are served;
- zoom is not disabled;
- offline status is explicit without horizontal overflow;
- the production service worker activates under preview;
- `/api/*` never enters the dashboard cache;
- a same-origin runtime image may enter the static cache;
- offline navigation returns the dedicated offline document rather than stale dashboard HTML.

The existing Playwright project matrix continues to cover 320 CSS px, A55-class portrait/landscape, other compact phones and desktop.

## Deferred to Phase 7B / production acceptance

- production deployment;
- actual installation on the Samsung Galaxy A55;
- Samsung Internet validation;
- Chrome Android installed-PWA validation;
- browser chrome expanded/retracted behavior;
- Android keyboard-open behavior;
- increased font/display scaling;
- Cloudflare Access/Tunnel interaction with the installed PWA.

## Production boundary

**Production deploy: NO.**
