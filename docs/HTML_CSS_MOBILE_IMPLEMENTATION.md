# HTML/CSS Mobile Implementation Guide

This is the implementation companion for [`MOBILE_SAMSUNG_A55.md`](MOBILE_SAMSUNG_A55.md).

## 1. `index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
    />
    <meta name="theme-color" content="#070b11" />
    <meta name="color-scheme" content="dark light" />
    <link rel="manifest" href="/app.webmanifest" />
    <title>dashboard_RPi5</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Do not disable zoom.

## 2. Semantic application shell

```html
<div class="app-shell">
  <a class="skip-link" href="#main-content">Skip to main content</a>

  <header class="mobile-header">
    <div>
      <strong>dashboard_RPi5</strong>
      <span>dash.rozkalns.net</span>
    </div>
    <span class="health-pill">Healthy</span>
  </header>

  <aside class="desktop-sidebar">
    <nav aria-label="Dashboard navigation">...</nav>
  </aside>

  <main id="main-content" class="main-content">
    ...
  </main>

  <nav class="mobile-nav" aria-label="Primary navigation">
    ...
  </nav>
</div>
```

## 3. Mobile-first tokens

```css
:root {
  color-scheme: dark;

  --safe-top: env(safe-area-inset-top, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);

  --bg: #070b11;
  --surface-1: #0e151f;
  --surface-2: #111b28;
  --surface-3: #162232;
  --border: #223044;

  --text: #f4f7fb;
  --muted: #aeb9c9;
  --subtle: #7f8da1;

  --accent: #5f8cff;
  --ok: #42d77d;
  --warning: #f0ad32;
  --danger: #ff5f6d;
  --info: #52a8ff;

  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 18px;

  --touch: 48px;
  --touch-primary: 52px;

  --page-pad: clamp(10px, 3.2vw, 16px);
  --gap: clamp(8px, 2.5vw, 14px);
}

* {
  box-sizing: border-box;
}

html {
  background: var(--bg);
  text-size-adjust: 100%;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100%;
  color: var(--text);
  background: var(--bg);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", sans-serif;
  line-height: 1.45;
}
```

## 4. Phone shell

```css
.app-shell {
  min-height: 100svh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.desktop-sidebar {
  display: none;
}

.mobile-header {
  position: sticky;
  z-index: 20;
  top: 0;
  min-height: calc(56px + var(--safe-top));
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 12px;
  padding:
    calc(8px + var(--safe-top))
    max(var(--page-pad), var(--safe-right))
    8px
    max(var(--page-pad), var(--safe-left));
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 92%, transparent);
  backdrop-filter: blur(12px);
}

.main-content {
  min-width: 0;
  padding:
    var(--page-pad)
    max(var(--page-pad), var(--safe-right))
    calc(var(--page-pad) + 8px)
    max(var(--page-pad), var(--safe-left));
}

.mobile-nav {
  position: sticky;
  z-index: 20;
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
  padding:
    6px
    max(8px, var(--safe-right))
    calc(6px + var(--safe-bottom))
    max(8px, var(--safe-left));
  border-top: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 94%, transparent);
  backdrop-filter: blur(14px);
}

.mobile-nav > a,
.mobile-nav > button {
  min-width: 0;
  min-height: 52px;
  border: 0;
  border-radius: 12px;
  display: grid;
  place-items: center;
  color: var(--muted);
  background: transparent;
  text-decoration: none;
  font: inherit;
  font-size: 0.72rem;
  font-weight: 700;
}

.mobile-nav > [aria-current="page"] {
  color: var(--text);
  background: var(--surface-2);
}
```

## 5. Cards and metrics

```css
.card {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-1);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gap);
}

.metric-card {
  min-height: 108px;
  padding: 14px;
}

.metric-card dt {
  color: var(--muted);
  font-size: 0.78rem;
}

.metric-card dd {
  margin: 8px 0 0;
  font-size: clamp(1.35rem, 6vw, 1.8rem);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.04em;
}

@media (max-width: 340px) {
  .metric-grid {
    grid-template-columns: 1fr;
  }
}
```

## 6. Component container queries

Do not tie every card's internal design to device width.

```css
.dashboard-card {
  container-type: inline-size;
}

.card-detail {
  display: grid;
  gap: 10px;
}

@container (min-width: 420px) {
  .card-detail {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }
}
```

## 7. Touch / pointer behavior

```css
button,
a,
summary,
input,
select {
  -webkit-tap-highlight-color: transparent;
}

button:focus-visible,
a:focus-visible,
summary:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--accent) 70%, white);
  outline-offset: 2px;
}

@media (hover: hover) and (pointer: fine) {
  .interactive:hover {
    background: var(--surface-2);
  }
}
```

Do not globally override `touch-action`.

## 8. Desktop enhancement

Mobile is the base. Desktop enhances it.

```css
@media (min-width: 900px) {
  .app-shell {
    grid-template-columns: 240px minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }

  .desktop-sidebar {
    grid-row: 1 / -1;
    display: block;
  }

  .mobile-nav,
  .mobile-header {
    display: none;
  }

  .main-content {
    padding: 24px;
  }
}
```

No A55-specific UA selector is needed.

## 9. Motion

```css
.interactive {
  transition:
    background-color 150ms ease,
    border-color 150ms ease,
    transform 150ms ease;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Never animate live telemetry merely because the display can refresh at 120 Hz.

## 10. Log viewer

```css
.log-page {
  height: 100dvh;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.log-viewer {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 10px;
  background: #05080d;
  font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
  font-size: clamp(0.74rem, 2.8vw, 0.82rem);
  line-height: 1.5;
}

.log-line {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.log-viewer[data-wrap="false"] .log-line {
  white-space: pre;
  overflow-wrap: normal;
}
```

## 11. Terminal

```css
.terminal-page {
  height: 100dvh;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  padding-top: var(--safe-top);
  padding-bottom: var(--safe-bottom);
  background: #05080d;
}

.terminal-host {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.terminal-accessory {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 6px 8px;
  overscroll-behavior-x: contain;
}

.terminal-accessory button {
  flex: 0 0 auto;
  min-width: 48px;
  min-height: 48px;
}
```

## 12. PWA manifest

```json
{
  "id": "/",
  "name": "dashboard_RPi5",
  "short_name": "RPi5",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#070b11",
  "theme_color": "#070b11",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

Do not force portrait orientation.

## 13. Service-worker cache boundary

Recommended cache allowlist:

```text
/
/index.html
/assets/<content-hashed-static-files>
/icons/*
/app.webmanifest
```

Network-only / never persistent cache:

```text
/api/**
/api/logs/**
/api/terminal/**
WebSocket terminal traffic
auth/session responses
```

If the shell loads while offline, clearly mark all operational data as unavailable/stale.
