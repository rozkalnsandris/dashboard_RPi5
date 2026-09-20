# ADR-0007 — HTML-first React + plain CSS frontend baseline

**Status:** Proposed; accepted when merged  
**Date:** 2026-09-20  
**Related:** issue #1, issue #247, issue #282, ADR-0004

## Decision

Keep React, Vite and TypeScript as the frontend application platform, but standardize the UI architecture around **semantic HTML first, browser-native behavior first, and plain product CSS as the canonical styling model**.

The durable frontend baseline is:

```text
Node.js + TypeScript
React + Vite

HTML-first UI
├── semantic HTML and native controls first
├── CSS custom properties for design tokens
├── plain product CSS as the canonical styling model
├── CSS cascade layers for explicit ordering
├── React Router for routing/lifecycle
├── TanStack Query for remote/live state
├── Lucide for icons
├── React Aria only for complex accessible composite widgets
└── xterm only inside the separately gated Terminal capability
```

This ADR supersedes the frontend-library portions of ADR-0004 that treated Tailwind CSS and shadcn/ui as architectural defaults. ADR-0004 remains historical authority for the original implementation choice and for the still-valid Node/TypeScript/React/Vite/Fastify/TypeBox decisions.

## Context

The first implementation deliberately selected a modern React toolchain. As the product matured, the source converged on a different styling reality than the original stack description:

- semantic JSX landmarks and native links/buttons are already common;
- CSS custom properties already carry the visual tokens;
- the UI is predominantly maintained as explicit feature/product CSS;
- `react-aria-components` has concrete use for the mobile More menu;
- Tailwind is still wired through `@import "tailwindcss"`, `@tailwindcss/vite`, package dependencies and therefore Preflight/base behavior;
- no durable shadcn/ui component layer is present in the current source tree.

The problem is therefore not React. The unnecessary complexity is having the documentation describe multiple styling/component abstractions as defaults when the source is already mostly semantic HTML plus product CSS.

## Current source versus target baseline

At adoption time, the repository may still contain Tailwind dependencies/plugin/imports and React Aria usages. This ADR does **not** claim those source changes have already happened.

The distinction is mandatory:

```text
CURRENT SOURCE
  may still contain Tailwind wiring and React Aria widgets

TARGET BASELINE
  HTML-first + plain CSS + native-first behavior
  with additional UI libraries only when justified
```

Dependency removal is a separate implementation change with its own exact source audit, tests and visual/accessibility regression evidence.

## Native-first rule

Choose the smallest browser platform primitive that satisfies the behavior and accessibility contract.

Prefer, in order:

1. semantic native HTML (`button`, `a`, `nav`, `main`, `aside`, `form`, `label`, `input`, `select`, `details`, `dialog`, tables, headings, lists);
2. modern browser primitives such as Popover where support and behavior are sufficient for the supported matrix;
3. small source-owned React composition;
4. React Aria when a composite widget needs non-trivial focus management, keyboard semantics or interaction behavior that would otherwise be reimplemented manually.

Do not replace a correct accessible React Aria widget merely to reduce dependency count. Any replacement must prove equivalent keyboard, focus, touch and screen-reader behavior on the supported browser/device matrix.

## Styling contract

Plain CSS is the canonical styling language for product UI.

Use CSS custom properties for tokens and use cascade layers to make precedence explicit:

```css
@layer reset, tokens, base, components, features, utilities;
```

Layer intent:

- `reset` — minimal reviewed normalization only;
- `tokens` — colors, spacing, radii, safe-area values, typography and semantic state tokens;
- `base` — document-level element defaults and focus behavior;
- `components` — reusable source-owned UI components;
- `features` — page/feature-specific layout and state styling;
- `utilities` — small intentionally maintained project utilities only.

Rules:

- product behavior must remain understandable without decoding a utility-class DSL;
- avoid broad global selectors that unexpectedly alter specialist views such as logs or terminal;
- prefer semantic state attributes/classes over deeply nested selectors;
- preserve `:focus-visible`, reduced-motion, zoom and 320 CSS px reflow contracts;
- migrate existing CSS incrementally; do not create an all-at-once visual rewrite solely to satisfy file organization.

## Library disposition

| Technology | Decision |
|---|---|
| React + Vite | Keep |
| TypeScript strict | Keep |
| React Router | Keep |
| TanStack Query | Keep |
| Lucide | Keep |
| plain CSS + CSS variables | Canonical default |
| CSS `@layer` | Adopt for cascade organization |
| Tailwind CSS | Remove from architectural baseline; remove from source only after exact usage/regression audit |
| shadcn/ui | Remove from architectural baseline; do not add a component framework by default |
| React Aria | Exception-only for justified complex interaction/accessibility |
| xterm | Keep only inside the Terminal capability |
| Fastify + TypeBox | Keep |
| Prometheus | Keep as metrics/history authority |
| Grafana | Keep as specialist/deep-analysis option; no current retirement commitment |

## Why React remains

`dashboard_RPi5` is an operations SPA with live server state, stale/error normalization, polling, routing, PWA behavior, log flows and a separately gated terminal. React remains useful for stateful composition and lifecycle management. Rewriting the product to vanilla JavaScript would spend risk and effort without removing the actual complexity boundaries.

## Why TanStack Query remains

Remote operational evidence requires controlled polling, cache/stale semantics, cancellation, reconnect behavior and explicit error states. TanStack Query solves this domain directly. Its defaults must still be reviewed; retries/refetch behavior must never hide source failure or create unnecessary RPi load.

## Why backend/trust-boundary complexity remains

This ADR simplifies the presentation layer only. It does not flatten security boundaries.

Accepted boundaries remain conceptually:

```text
browser/web
  -> main agent
      -> bounded Docker broker
          -> Docker Engine

browser
  -> terminal admission / WebSocket
      -> contained terminal-agent
          -> normal-user PTY
```

The Docker broker remains the sole Docker Engine authority. The terminal agent remains isolated from privileged-read authority. Those components exist to reduce blast radius and must not be collapsed merely to reduce process count.

## Observability/product-scope boundary

The dashboard is a **daily operations cockpit**, not a general visualization platform.

In scope:

- current host/container/service health;
- bounded `1h` / `24h` / `7d` operational history;
- predefined Top Consumers and attention views;
- accessible numeric summaries;
- drill-down links to specialist evidence/tools.

Out of scope unless a later explicit product-contract change proves otherwise:

- browser-supplied PromQL;
- arbitrary dashboard/panel composition;
- a general visualization/query builder;
- a duplicate metrics database;
- recreating Grafana feature-for-feature;
- removing Grafana merely because selected native charts exist.

Prometheus remains the time-series authority. Grafana remains an optional specialist/deep-analysis tool. A future decision to remove Grafana must be justified by a separate contract/operations review and any runtime decommissioning remains owner-authorized LIVE work.

## Migration sequence

Use small reversible source changes:

1. adopt this documentation baseline;
2. audit exact Tailwind utility/theme/Preflight reliance;
3. if no required reliance remains, remove `@import "tailwindcss"`, `@tailwindcss/vite`, Tailwind dependencies and lockfile entries in one focused source PR;
4. add explicit CSS only for behavior that was actually provided by Tailwind/Preflight;
5. migrate the CSS corpus into documented layers incrementally;
6. inventory React Aria usage and keep only behaviorally justified cases;
7. extract source-owned components only when repeated behavior/styles justify them.

Each UI-affecting step must preserve A55 and accessibility acceptance, including 320 px reflow, 412×915 regression coverage, keyboard navigation, touch targets, safe areas, zoom and reduced motion.

## Consequences

Positive:

- fewer frontend concepts are required to understand or change the UI;
- source and documentation match more closely;
- styling behavior becomes more explicit and easier to audit;
- native accessibility semantics are preferred before custom abstractions;
- dependency removal can reduce build/cascade surface without changing the application architecture;
- specialist tools remain authoritative instead of being reimplemented inside the dashboard.

Costs:

- source-owned CSS requires discipline and naming consistency;
- migration from the existing Tailwind/Preflight baseline must be regression-tested;
- browser support must be checked before adopting newer native primitives;
- complex composite widgets may still justify React Aria.

## Non-goals

This ADR does not authorize or require:

- React-to-vanilla-JS rewrite;
- Next.js or another frontend-framework migration;
- a new generic component library;
- immediate deletion of Tailwind dependencies without source evidence;
- forced removal of React Aria;
- backend/agent/broker consolidation;
- Prometheus replacement;
- Grafana clone or Grafana production removal;
- production deployment or any RPi5/systemd/Docker/Cloudflare/runtime mutation.

## References

- React — incremental React usage: <https://react.dev/learn/add-react-to-an-existing-project>
- MDN — CSS cascade layers: <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@layer>
- MDN — Popover API: <https://developer.mozilla.org/en-US/docs/Web/API/Popover_API>
- W3C WAI-ARIA APG — Menu Button Pattern: <https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/>
- Tailwind — Preflight: <https://tailwindcss.com/docs/preflight>
