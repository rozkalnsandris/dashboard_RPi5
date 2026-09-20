# dashboard_RPi5 — Implementation Stack

> **Status:** durable implementation/trust-boundary reference  
> **Original stack decision:** ADR-0004  
> **Current frontend baseline:** ADR-0007  
> **Master contract:** GitHub issue #1  
> **Target hostname:** `dash.rozkalns.net`

This document separates **current source reality** from the **durable target architecture**. Mutable runtime/release state is intentionally not stored here; use canonical handoff issue #213 plus fresh trusted-host evidence for current production state.

## Durable stack

```text
Node.js 24 LTS
└── npm workspaces + TypeScript strict mode
    ├── apps/web
    │   ├── React
    │   ├── Vite
    │   ├── React Router
    │   ├── TanStack Query
    │   ├── semantic HTML / native controls first
    │   ├── plain product CSS + CSS custom properties
    │   ├── CSS cascade layers
    │   ├── Lucide icons
    │   ├── React Aria only for justified complex widgets
    │   └── xterm only for the separately gated Terminal capability
    │
    ├── apps/server
    │   └── Fastify 5
    │
    ├── apps/agent
    │   └── Fastify 5 / Unix socket / privileged-read evidence
    │
    ├── apps/terminal-agent
    │   └── contained normal-user native PTY boundary
    │
    └── packages/contracts
        └── TypeBox runtime schemas + Fastify type provider
```

## Current frontend source reality

The source has already converged toward semantic JSX and explicit product CSS, but migration is incomplete:

- `apps/web/src/styles.css` is predominantly explicit CSS with CSS custom properties;
- that stylesheet still imports `tailwindcss`;
- `apps/web/vite.config.ts` still activates `@tailwindcss/vite`;
- `apps/web/package.json` still includes Tailwind dependencies;
- `react-aria-components` is used by the mobile More menu;
- there is no durable shadcn/ui component layer that should be treated as a project-wide architecture requirement.

Therefore:

- **Tailwind is not the target baseline**, but it is still current source until a focused cleanup proves removal is safe;
- **shadcn/ui is not an architectural baseline** and new UI work must not assume it;
- **React Aria is exception-only**, retained where its accessibility/interaction value is concrete.

## Frontend composition rule

Use the smallest layer that solves the problem:

```text
semantic HTML
  -> browser-native behavior
      -> source-owned React composition
          -> React Aria only if complex interaction requires it
```

Do not replace a working accessible composite widget merely to remove a dependency. Prove equivalent focus, keyboard, touch and screen-reader behavior first.

## CSS baseline

Plain product CSS is canonical. Design tokens live in CSS custom properties.

Target cascade ordering:

```css
@layer reset, tokens, base, components, features, utilities;
```

Migrate incrementally. Do not perform a visual rewrite simply to reorganize files. Every UI-affecting migration must preserve:

- 320 CSS px reflow;
- A55-class 412×915 regression target;
- Samsung Browser + Chrome compatibility;
- browser + PWA behavior;
- zoom and safe areas;
- keyboard-safe Logs/Terminal flows;
- normal 48px touch targets;
- visible focus and reduced-motion behavior.

See `docs/HTML_CSS_MOBILE_IMPLEMENTATION.md` and ADR-0007.

## Why React + Vite remain

`dashboard_RPi5` is a private operations SPA with live server state, polling/staleness/error semantics, routing, PWA behavior, logs and a separately gated terminal. React remains useful for stateful composition. Vite keeps build/runtime semantics explicit without SSR/RSC framework complexity.

A React-to-vanilla-JavaScript rewrite is not a simplification target.

## Why React Router remains

The project needs explicit route lifecycle, navigation and error boundaries without coupling the backend to a full-stack frontend framework.

## Why TanStack Query remains

Operational evidence needs controlled polling, caching, stale/error semantics, cancellation and reconnect/refocus behavior. Defaults must be reviewed so retries or refetching never hide source failure or create unnecessary RPi load.

## Why Fastify + TypeBox remain

The server/agent interfaces are trust boundaries. Schema-first request/response handling and shared runtime validation reduce accidental field leakage and protocol drift. This complexity is security-relevant and should not be removed merely for line-count reduction.

## Trust boundaries that must remain explicit

### Browser / web API

The browser is untrusted for host authority. The web/API process must not own Docker Engine socket access, generic shell/root capability or unrestricted host mutation.

### Main agent / Docker broker

```text
web/API
  -> main agent
      -> fixed typed Docker broker capability
          -> Docker Engine Unix socket
```

The dedicated Docker broker remains the sole Docker Engine authority. Do not flatten this into one privileged web/backend process.

### Terminal

```text
browser
  -> owner-authenticated terminal admission / WebSocket
      -> contained terminal-agent
          -> normal-user PTY
```

The terminal boundary must not inherit main-agent or Docker-broker authority. Production activation remains separately owner-gated.

## Data ownership and product scope

```text
Prometheus      = time-series/history authority
Grafana         = specialist/deep-analysis option
Docker Engine   = authoritative container runtime state/events/logs
Docker broker   = sole bounded Engine-socket authority
systemd/journal = host service state/logs
main agent      = narrow normalized host/local evidence bridge
dashboard       = daily operational presentation + attention projection
terminal agent  = separately gated contained PTY boundary
```

The dashboard may add predefined native `1h` / `24h` / `7d` history and Top Consumers. It must not become a generic PromQL endpoint, arbitrary visualization builder or duplicate TSDB.

Grafana retirement is not part of the current durable product contract. A future removal decision requires separate architecture/operations evidence and LIVE decommissioning authorization.

## Deliberately rejected directions

| Alternative | Reason not selected |
|---|---|
| Next.js | SSR/RSC/SEO complexity without sufficient value for this private SPA |
| React-to-vanilla rewrite | removes useful state composition while not simplifying trust boundaries |
| React Router Framework Mode | unnecessary full-stack framework coupling beside Fastify |
| Express | weaker fit than Fastify's schema/serialization model |
| generic component framework | additional abstraction/visual override burden without demonstrated need |
| Tailwind as mandatory baseline | current source is already predominantly explicit product CSS; creates a second styling/cascade model |
| Grafana as product frontend | cannot provide the required operational/log/terminal UX cleanly |
| Grafana clone in dashboard | scope expansion; duplicates specialist visualization capabilities |
| duplicate metrics database | Prometheus is already the time-series authority |
| main agent -> Docker Engine socket | violates broker-only Docker authority |
| generic Docker proxy | grants host-level authority beyond reviewed capabilities |
| PTY inside privileged-read main agent | lets free-form shell inherit unrelated privileges |

## Follow-up source cleanup

ADR-0007 adoption does not itself remove dependencies. The next focused frontend simplification work should:

1. audit exact Tailwind utilities/theme/Preflight reliance;
2. remove Tailwind import/plugin/packages/lockfile entries only if the audit proves no required behavior remains;
3. replace any relied-on base behavior with explicit CSS;
4. run typecheck/tests/build and UI/A55/accessibility regressions;
5. migrate CSS into cascade layers incrementally;
6. inventory React Aria use and retain only behaviorally justified cases.

## Governance

Normal workflow remains:

```text
issue -> fresh main -> fresh branch -> focused change -> Draft PR
-> exact-head CI + manual review -> Ready -> STOP
-> explicit owner squash merge -> exact-main verification
-> classify Production deploy: YES / NO
```

Merge authorization is not deployment authorization. Runtime, host, Docker-authority, terminal, systemd, Cloudflare and other production/trust-boundary mutations require separate explicit owner authorization.
