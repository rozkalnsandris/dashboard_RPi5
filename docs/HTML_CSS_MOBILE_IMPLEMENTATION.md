# HTML/CSS Mobile Implementation Guide

This is the canonical frontend implementation companion for [`MOBILE_SAMSUNG_A55.md`](MOBILE_SAMSUNG_A55.md) and ADR-0007.

## 1. Architecture rule: HTML first

Use React as the application/composition layer, not as a reason to replace browser semantics.

Default order:

```text
semantic HTML
  -> browser-native controls/primitives
      -> source-owned React composition
          -> React Aria only for genuinely complex accessible widgets
```

Use real landmarks, headings, links, buttons, forms, labels, tables and lists. Do not build div/span substitutes for native controls when native semantics satisfy the requirement.

Current source may still contain Tailwind wiring. The target styling model is plain product CSS; removal of Tailwind is a separate source change after exact usage/Preflight and visual regression audit.

## 2. CSS architecture

CSS custom properties are the canonical design-token layer. New and migrated CSS should follow this ordering:

```css
@layer reset, tokens, base, components, features, utilities;
```

Use the layers deliberately:

- `reset` — minimal reviewed normalization;
- `tokens` — colors, spacing, radii, safe areas, typography and semantic state values;
- `base` — document/element defaults and focus behavior;
- `components` — reusable source-owned UI patterns;
- `features` — page/feature styling;
- `utilities` — a small project-owned utility set only when repetition justifies it.

Do not migrate all existing CSS in one visual rewrite. Move bounded feature areas incrementally and compare behavior at each step.

## 3. Document baseline

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
    <link rel="manifest" href="/manifest.webmanifest" />
    <title>dashboard_RPi5</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Never disable zoom.

## 4. Semantic shell

The React shell should render semantics equivalent to:

```html
<div class="app-shell">
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <aside class="desktop-sidebar">
    <nav aria-label="Dashboard navigation">...</nav>
  </aside>
  <header class="workspace-header">...</header>
  <main id="main-content" class="main-content">...</main>
  <nav class="mobile-nav" aria-label="Primary navigation">...</nav>
</div>
```

Status text must come from normalized operational evidence. Missing/stale/unavailable evidence is never hard-coded as healthy.

## 5. Token baseline

```css
@layer tokens {
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
}
```

Do not duplicate semantic token meanings inside component-local magic values unless there is a specific reviewed need.

## 6. Base behavior

```css
@layer reset {
  *, *::before, *::after { box-sizing: border-box; }
}

@layer base {
  html { min-width: 320px; background: var(--bg); text-size-adjust: 100%; }
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

  button, a, summary, input, select { -webkit-tap-highlight-color: transparent; }
  button:focus-visible,
  a:focus-visible,
  summary:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 3px solid color-mix(in srgb, var(--accent) 70%, white);
    outline-offset: 2px;
  }
}
```

Do not globally override `touch-action`.

## 7. Mobile shell

Mobile is the base; desktop enhances it.

```css
@layer components {
  .app-shell {
    min-height: 100svh;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  .desktop-sidebar { display: none; }

  .main-content {
    min-width: 0;
    padding: var(--page-pad)
      max(var(--page-pad), var(--safe-right))
      calc(var(--page-pad) + 8px)
      max(var(--page-pad), var(--safe-left));
  }

  .mobile-nav {
    position: sticky;
    z-index: 30;
    bottom: 0;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 4px;
    padding: 6px max(8px, var(--safe-right))
      calc(6px + var(--safe-bottom)) max(8px, var(--safe-left));
  }
}
```

No A55-specific UA/model selector is allowed.

## 8. Container queries and responsive design

Use media queries for shell/navigation transitions. Use container queries for reusable component internals when the component's available space, not device width, is the relevant constraint.

```css
.dashboard-card { container-type: inline-size; }

@container (min-width: 420px) {
  .card-detail {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }
}
```

Required regression matrix remains:

```text
320 × 700
360 × 800
384 × 854
393 × 873
412 × 915
430 × 932
800 × 360
915 × 412
```

The physical Samsung Galaxy A55 remains the mobile acceptance device.

## 9. Native controls versus React Aria

Prefer native controls where behavior is sufficient. React Aria is justified when a composite widget needs focus roving, keyboard behavior, dismissal semantics or other accessibility behavior that would otherwise require custom implementation.

For the current mobile More menu, do not remove React Aria purely for dependency reduction. A native Popover/menu replacement must first prove equivalent behavior in Samsung Browser, Chrome, keyboard navigation, screen-reader use and touch interaction.

## 10. Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Never animate live telemetry merely because the display supports a high refresh rate.

## 11. Logs and terminal specialist surfaces

Logs and terminal have stricter full-height/keyboard/overflow requirements. Use `100dvh` deliberately there, not as a universal page-height replacement.

```css
.log-page,
.terminal-page {
  min-height: 0;
  height: 100dvh;
}

.log-viewer {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}

.terminal-host {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
```

The CSS for a Terminal view does not imply that production PTY is active. Terminal activation remains separately owner-authorized.

## 12. PWA/cache boundary

Static shell resources may be cached deliberately. Operational evidence stays network-authoritative.

Safe static-shell candidates:

```text
/
/index.html
/assets/<content-hashed-static-files>
/icons/*
/manifest.webmanifest
```

Never persistently cache:

```text
/api/**
/api/logs/**
/api/terminal/**
WebSocket terminal traffic
auth/session responses
```

If the shell loads offline, mark operational evidence unavailable/stale; never synthesize healthy state from cached UI.

## 13. Tailwind removal acceptance

Tailwind removal is not complete merely because no utility classes are obvious. Before source removal:

1. inventory utility/theme/config usage;
2. account for Tailwind Preflight/base behavior;
3. replace only relied-on behavior with explicit CSS;
4. remove `@import "tailwindcss"`, `@tailwindcss/vite`, package dependencies and lockfile entries together;
5. run typecheck, tests and production build;
6. run the mobile viewport regression matrix and physical A55 acceptance where behavior can change;
7. verify focus, form/control defaults, typography, tables, media, dialogs/popovers, logs and terminal surfaces for regressions.

Do not mix dependency cleanup with unrelated visual redesign.
