# Web response security and cache contract

Issue: #167

This document defines the source-level HTTP response contract for the dashboard web/API process. It does not claim or mutate Cloudflare edge settings.

## Ownership model

The dashboard application is authoritative for browser-facing response hardening that can be proven from repository source:

- Content Security Policy (CSP);
- `X-Content-Type-Options`;
- `Referrer-Policy`;
- `Permissions-Policy`;
- the operational API cache policy;
- the SPA document cache policy.

Cloudflare remains the external HTTPS termination, Access and Tunnel boundary. HSTS is therefore an edge/HTTPS-termination concern rather than a loopback-origin header in this application. The server deliberately does not emit `Strict-Transport-Security`; current Cloudflare HSTS behavior must be verified independently before any claim about live edge responses.

No Cloudflare configuration is changed by #167.

## Application security headers

Every HTTP response produced through the Fastify application receives:

```text
Content-Security-Policy: default-src 'none'; base-uri 'none'; connect-src 'self' wss://dash.rozkalns.net; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; manifest-src 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()
```

The application deliberately does not emit `X-Frame-Options`; clickjacking protection is owned by CSP `frame-ancestors 'none'` so there is one framing policy rather than two potentially divergent controls.

### CSP rationale

The policy starts from `default-src 'none'` and opens only resources required by the current first-party application.

- `script-src 'self'` allows only bundled first-party JavaScript. There is no `unsafe-inline` and no `unsafe-eval` script exception.
- `connect-src 'self' wss://dash.rozkalns.net` permits same-origin fetches and explicitly permits the canonical production WebSocket origin. The explicit WSS source avoids relying on browser-specific interpretation of `'self'` for WebSocket schemes while still avoiding a generic `wss:` allowance.
- `worker-src 'self'` permits the local PWA service worker only.
- `manifest-src 'self'`, `font-src 'self'` and `img-src 'self' data:` cover current first-party application resources.
- `base-uri 'none'`, `object-src 'none'` and `frame-ancestors 'none'` remove unused high-risk embedding surfaces.
- `style-src 'self' 'unsafe-inline'` is the one intentional CSP relaxation. The dashboard uses xterm.js 6 for the separately gated terminal UI; xterm performs runtime DOM style manipulation required for terminal sizing/composition/rendering. This exception applies to styles only. It does not widen script execution, network destinations, frames or objects.

The terminal remains separately owner-gated. This response policy does not activate a terminal socket, service, permission or production feature flag.

## Cache contract

Operational evidence must never inherit shared or heuristic caching.

### Dynamic API

Every request to `/api`, `/api?...` or `/api/*` receives:

```text
Cache-Control: no-store
```

The policy is installed centrally before route handlers, so it covers successful responses, validation failures, unavailable-source responses, terminal API responses and unknown API routes. Existing route-local `no-store` assignments may remain as defense-in-depth, but they are not the authoritative source of coverage.

### Browser documents

`index.html` and SPA fallback documents remain:

```text
Cache-Control: no-store
```

A navigated dashboard document therefore cannot be treated as durable operational evidence.

### Static assets

The existing static-file policy remains long-lived/immutable for static resources. Vite production bundles are content-fingerprinted and may use this cache behavior safely. The service worker continues to bypass `/api/*` entirely and keeps navigated dashboard documents network-authoritative.

## HSTS and Cloudflare boundary

The production request path is:

```text
browser
  -> HTTPS + Cloudflare Access
  -> Cloudflare Tunnel
  -> dashboard web/API on loopback
```

The application sees the inner origin hop and must not pretend to own the external TLS/HSTS policy. HSTS must be reviewed at the public HTTPS termination layer. Adding or changing Cloudflare HSTS, Access, Tunnel, DNS or Transform Rules is outside #167 and requires separate owner authorization.

## Regression evidence

`apps/server/src/http-response-policy.test.ts` proves at source level that:

- normal operational API responses are `no-store`;
- API validation errors and API 404 responses are also `no-store`;
- CSP, `nosniff`, referrer and permissions policies are present;
- the application does not emit HSTS or a competing `X-Frame-Options` policy;
- SPA documents are `no-store`;
- immutable static asset caching is preserved;
- CSP keeps scripts on `'self'`, contains no `unsafe-eval`, and retains only the documented xterm style exception;
- the canonical production WSS origin is explicitly permitted.

## Non-goals

#167 does not:

- change Cloudflare configuration;
- prove current live edge headers;
- deploy the new application source;
- activate the full terminal;
- change systemd, Docker authority, host permissions or secrets;
- introduce third-party runtime JavaScript.
