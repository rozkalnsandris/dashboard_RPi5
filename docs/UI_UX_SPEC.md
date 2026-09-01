# UI / UX Specification

## Visual direction

A modern operations dashboard should use current layout language without turning monitoring into decoration.

Chosen style:

- dark-first charcoal/deep-navy canvas;
- 1px neutral borders;
- subtle elevation/translucency only on navigation chrome;
- bento-style cards used for hierarchy, not novelty;
- one interaction accent;
- semantic green/amber/red/blue state colors;
- 14–18px corner radii;
- compact tables;
- small sparklines;
- restrained motion;
- high information density with generous internal spacing.

Avoid:

- strong glass blur on data cards;
- giant marketing typography;
- gradients behind critical values;
- animated gauges everywhere;
- pie/donut chart for every percentage;
- wall-of-Grafana duplication.

## Samsung Galaxy A55 reference device

The **Galaxy A55 is the primary physical mobile acceptance device**. Samsung specifies a 6.6-inch 1080×2340 120 Hz display, but those hardware pixels are not CSS layout breakpoints. The product uses mobile-first responsive CSS and is tested from 320 CSS px upward, with a practical A55-class automated target at 412×915 plus real-device testing.

Mandatory mobile behavior:

- bottom navigation instead of desktop sidebar;
- 48px minimum normal touch target, 52px primary actions where practical;
- safe-area environment insets;
- stable `svh` shell and deliberate `dvh` on terminal/log full-height views;
- keyboard-safe search/log/terminal flows;
- no hover-only state;
- no UA/model sniffing;
- no portrait lock;
- Samsung Browser + Chrome;
- normal browser + installed PWA.

Full contract: [`MOBILE_SAMSUNG_A55.md`](MOBILE_SAMSUNG_A55.md).  
Concrete markup/CSS: [`HTML_CSS_MOBILE_IMPLEMENTATION.md`](HTML_CSS_MOBILE_IMPLEMENTATION.md).

## Desktop shell

```text
┌──────────────────┬──────────────────────────────────────────────────────────────┐
│ dashboard_RPi5   │ Overview                       Search  Alerts  Owner          │
│ dash.rozkalns…   ├──────────────────────────────────────────────────────────────┤
│                  │ HEALTH  UPTIME  TEMP  THROTTLE  CPU  RAM  NVMe               │
│ Overview         │                                                              │
│ Docker           │ Docker containers        Top Consumers       Activity         │
│ Services         │ container/status/stats   CPU RAM NET DISK    recent changes   │
│ Logs             │                                                              │
│ Terminal         │ Endpoints       Backups        Needs Attention                │
│ Activity         │                                                              │
│ Deployments      │ RPi model · Debian · Kernel · Load · Temp · last refresh     │
│ Backups          │                                                              │
└──────────────────┴──────────────────────────────────────────────────────────────┘
```

Sidebar approximately 220–260 CSS px; collapsible at intermediate widths.

## Mobile shell

No squeezed desktop sidebar.

Use:

- compact sticky header;
- one-column cards;
- 4–5 primary destinations plus More;
- mobile Docker rows/cards;
- Quick Commands as the preferred phone diagnostic workflow.

## Overview priority

1. system state / Needs Attention;
2. temperature + throttle/power;
3. CPU/RAM/NVMe;
4. Docker state and top consumers;
5. recent activity;
6. backups/endpoints/updates;
7. deep links.

## Modern interaction patterns to adopt

- progressive disclosure;
- command/search palette for **navigation and search only** (`Ctrl/Cmd+K`), not destructive command execution;
- inline sparklines;
- sticky table headers for long Docker lists;
- contextual drawer/detail pane on desktop;
- bottom sheet/full page details on mobile;
- visible stale/live timestamps;
- skeleton loading only for first load, not constant shimmer during polling;
- optimistic UI is **not** used for host mutations.

## HTML semantics

Use:

- `<nav>` navigation;
- one `<main>` per document;
- labeled `<section>` regions;
- `<article>` for standalone status cards;
- real `<table>` for desktop Docker metrics;
- `<details>/<summary>` for supporting evidence;
- `<dialog>` only for true modal interactions;
- `<button>` for actions;
- `<a>` for navigation.

Do not build click targets from plain `<div>` elements.

## CSS architecture

Use native modern CSS first:

- CSS custom-property design tokens;
- Grid for page/card composition;
- Flexbox within components;
- container queries for reusable cards;
- `clamp()` for controlled responsive spacing/type;
- `content-visibility: auto` only on appropriate below-fold sections;
- `prefers-reduced-motion` support;
- dynamic viewport units where useful;
- safe-area insets on phone layouts.

Example tokens:

```css
:root {
  color-scheme: dark;

  --bg-canvas: #070b11;
  --bg-sidebar: #0a1019;
  --surface-1: #0e151f;
  --surface-2: #111b28;
  --surface-3: #162232;
  --border: #223044;

  --text-1: #f4f7fb;
  --text-2: #b9c4d3;
  --text-3: #7f8da1;

  --accent: #5f8cff;
  --ok: #42d77d;
  --warning: #f0ad32;
  --danger: #ff5f6d;
  --info: #52a8ff;

  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 18px;
}
```

## Accessibility

Target WCAG 2.2 AA.

- visible `:focus-visible`;
- browser/PWA document title follows the active top-level destination as `<Route> · dashboard_RPi5` and updates after client-side navigation;
- status is text + icon + color, never color-only;
- adequate touch targets;
- reduced-motion support;
- chart values have text equivalents;
- live logs can be paused;
- no forced auto-scroll after user scrolls away from newest line;
- terminal accessibility settings exposed when supported;
- focus restored correctly after dialogs/drawers.
