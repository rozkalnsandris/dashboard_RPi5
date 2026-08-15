# dashboard_RPi5 — Implementation Stack

> **Status:** accepted implementation baseline for Phase 1  
> **Decision date:** 2026-08-15  
> **Master contract:** GitHub issue #1  
> **Implementation issue:** #3  
> **Target hostname:** `dash.rozkalns.net`

## Chosen stack

```text
Node.js 24 LTS
└── npm workspaces + TypeScript strict mode
    ├── apps/web
    │   ├── React 19
    │   ├── Vite 8.1
    │   ├── React Router 8 — Data Mode
    │   ├── TanStack Query
    │   ├── shadcn/ui
    │   │    └── React Aria base where appropriate
    │   ├── Tailwind CSS 4
    │   └── Lucide icons
    │
    ├── apps/server
    │   └── Fastify 5
    │
    ├── apps/agent
    │   └── Fastify 5 / Unix socket
    │
    └── packages/contracts
        └── TypeBox schemas + Fastify type provider
```

## Repository layout

```text
dashboard_RPi5/
├── apps/
│   ├── web/
│   │   ├── routes/
│   │   ├── components/
│   │   │   ├── ui/
│   │   │   ├── dashboard/
│   │   │   └── docker/
│   │   ├── queries/
│   │   ├── styles/
│   │   └── fixtures/
│   ├── server/
│   │   ├── routes/
│   │   ├── services/
│   │   └── plugins/
│   └── agent/
│       ├── system/
│       ├── docker/
│       ├── journal/
│       └── commands/
├── packages/
│   └── contracts/
├── tests/
└── docs/
```

Do not create additional shared packages until a concrete duplication/problem justifies them.

## Why Node.js 24 LTS

Production runtime uses the current LTS line rather than Node Current.

Benefits:

- one runtime across web tooling, API and local agent;
- one TypeScript toolchain;
- deterministic CI/runtime contract;
- no second language/runtime without a measured need.

A future Go/Rust agent is not ruled out, but it requires evidence that the TypeScript agent is inadequate.

## Why React + Vite instead of Next.js

`dashboard_RPi5` is a private authenticated operations SPA. It has no meaningful SEO/SSR requirement.

Next.js/RSC would add rendering, caching and deployment semantics that do not solve the primary problem: a deliberate browser/API/local-agent trust boundary.

Vite keeps the frontend explicit and small, while React remains the component model.

## Why React Router Data Mode

Use React Router Data Mode instead of a bare `BrowserRouter` or the full React Router framework mode.

It provides:

- route loaders;
- pending/error boundaries;
- structured route data lifecycle;
- lazy route modules;

without coupling the project to a server-rendering framework.

Planned routes:

```text
/
/docker
/docker/:containerId
/services
/services/:serviceId
/logs
/terminal
/activity
/backups
/deployments
/settings
```

## Why TanStack Query

Server/telemetry state needs explicit stale/refetch/error semantics.

Use TanStack Query for:

- caching;
- controlled polling;
- stale timestamps;
- reconnect/refocus behavior;
- request cancellation;
- query invalidation.

Defaults must be reviewed rather than accepted blindly. In particular, health/agent failures should become visible promptly instead of being hidden behind excessive retries.

Initial cadence targets remain domain-specific, for example:

```text
host summary     10s visible / slow or paused hidden
Docker stats     10s visible / slow or paused hidden
endpoint health  30s
backup state     60s+
history charts   30–60s while visible
logs             explicit live stream only
```

## Why shadcn/ui + React Aria

shadcn/ui is the component source baseline, **not the product visual design**.

The audited `dashboard_RPi5` desktop and Samsung A55 mockups remain visual source-of-truth.

Benefits:

- components are copied into this repository and can be fully modified;
- current dashboard/sidebar/table primitives are close to our information architecture;
- React Aria base provides strong keyboard, touch, focus and screen-reader behavior;
- especially useful for Samsung Galaxy A55 as the first-class physical mobile target.

The project must not ship a generic stock shadcn appearance.

## Why Tailwind CSS 4

Tailwind is used as a layout/utility layer, while CSS custom properties remain the canonical design-token layer.

Use Tailwind for:

- responsive composition;
- grid/flex utilities;
- state utilities;
- container-query utilities;
- spacing/layout consistency.

Use CSS variables for product identity:

```css
--bg-canvas
--surface-1
--surface-2
--border-subtle
--text-primary
--text-secondary
--accent
--health-ok
--health-warning
--health-critical
--health-info
```

Do not scatter raw one-off colors throughout component markup.

## Why Fastify 5

Fastify is the API/server baseline instead of Express.

Reasons:

- schema-first request/response handling;
- bounded serialization contracts;
- response schemas reduce accidental field leakage;
- official type-provider support;
- good fit for a narrow local operational API.

The dashboard server binds loopback in production behind Cloudflare Tunnel.

## Why TypeBox shared contracts

Use shared runtime schemas from `packages/contracts`.

Examples:

```text
RpiSummarySchema
DockerContainerSchema
ActivityEventSchema
BackupStatusSchema
ApiErrorSchema
```

These contracts are consumed by server, agent, frontend adapters and tests.

Goal: avoid maintaining separate TypeScript interfaces and unrelated runtime validators that can drift.

## Local agent boundary

The local agent remains a separate trust boundary.

Preferred transport:

```text
/run/dashboard-rpi5/agent.sock
```

Only the agent may later access:

- Docker Engine Unix socket;
- systemd/journal;
- `vcgencmd`;
- `/proc`/`sysfs` operational evidence;
- registered Quick Commands;
- later bounded PTY creation.

The Internet-facing web/API process must not become a generic root/Docker proxy.

## Data ownership

```text
Prometheus  = time-series/history
Grafana     = deep visualization
Docker      = container runtime state/events/logs
systemd     = host service state/logs
RPi agent   = narrow local evidence bridge
dashboard   = normalized presentation + attention projection
```

Do not create a duplicate metrics database only to redraw existing Prometheus history.

## Deliberately rejected initial alternatives

| Alternative | Reason not selected |
|---|---|
| Next.js | SSR/RSC/SEO complexity without sufficient value for this private SPA |
| React Router Framework Mode | unnecessary full-stack framework coupling beside Fastify |
| Express | weaker fit than Fastify's schema/serialization/type-provider model |
| Material UI | too opinionated visually for the audited custom design |
| Ant Design | strong enterprise library, but heavier visual override burden |
| Bootstrap | too generic for the target operations UI |
| only custom CSS/components | too much reinvention of accessible dialogs/menus/selects/navigation |
| Grafana as frontend | cannot provide the required logs/terminal/activity/control UX cleanly |
| Python backend | unnecessary second runtime/toolchain |
| Go agent immediately | no measured performance/footprint requirement yet |

## Phase 1 scope boundary

Phase 1 implements fixture-only application foundation.

Allowed:

- workspace/toolchain;
- web shell;
- Fastify health endpoint;
- shared contracts;
- fixture pages;
- desktop sidebar;
- Samsung A55 bottom navigation;
- accessibility/responsive states;
- CI/tests/build.

Not allowed in Phase 1:

- live RPi data;
- Prometheus production reads;
- Docker socket access;
- systemd/journal access;
- Quick Command execution;
- PTY terminal;
- Cloudflare/DNS/Access mutation;
- production deployment;
- host/root/container mutation.

## Governance

Normal workflow remains:

```text
issue -> fresh main -> fresh branch -> focused change -> Draft PR
-> exact-head CI + manual review -> Ready -> STOP
-> explicit owner squash merge -> exact-main verification
-> classify Production deploy: YES / NO
```

**Merge authorization is not deployment authorization.**
