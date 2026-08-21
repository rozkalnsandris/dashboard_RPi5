# dashboard_RPi5 — Implementation Stack

> **Status:** current implementation and trust-boundary reference  
> **Original stack decision:** 2026-08-15  
> **Master contract:** GitHub issue #1  
> **Target hostname:** `dash.rozkalns.net`

The original Phase 1 technology choices remain the implementation baseline, but this document now reflects the current repository layout and the trust boundaries added as the project progressed into live operation.

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
    │   └── Fastify 5 / Unix socket / privileged-read evidence
    │
    ├── apps/terminal-agent
    │   └── contained normal-user native PTY boundary
    │
    └── packages/contracts
        └── TypeBox schemas + Fastify type provider
```

## Current repository layout

```text
dashboard_RPi5/
├── apps/
│   ├── web/
│   │   ├── src/components/
│   │   ├── src/pages/
│   │   └── public/
│   ├── server/
│   │   └── src/
│   ├── agent/
│   │   └── src/
│   └── terminal-agent/
│       └── src/
├── packages/
│   └── contracts/
├── ops/
│   ├── production/
│   └── systemd/
├── tests/
│   └── e2e/
├── tools/
└── docs/
```

Do not create additional shared packages until a concrete duplication/problem justifies them.

## Why Node.js 24 LTS

Production runtime uses the Node 24 LTS line rather than Node Current.

Benefits:

- one runtime across web tooling, API, main agent and terminal-agent source;
- one TypeScript toolchain;
- deterministic CI/runtime contract;
- no second language/runtime without a measured need.

A future Go/Rust component is not ruled out, but it requires evidence that the current TypeScript implementation is inadequate.

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

Current/planned top-level routes remain centered on:

```text
/
/docker
/services
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

Defaults must be reviewed rather than accepted blindly. Health/agent failures must become visible promptly instead of being hidden behind excessive retries.

Polling cadence remains domain-specific; the dashboard must not become a meaningful source of RPi load.

## Why shadcn/ui + React Aria

shadcn/ui is a component-source baseline, not the product visual design.

The audited `dashboard_RPi5` desktop and Samsung A55 contracts remain the visual source of truth.

React Aria-style accessible behavior is useful for keyboard, touch, focus and screen-reader interactions. The project must not ship a generic stock component-library appearance.

## Why Tailwind CSS 4

Tailwind is used as a layout/utility layer, while CSS custom properties remain the canonical design-token layer.

Use utility classes where they improve composition and consistency; keep product identity in reviewed tokens rather than scattering raw one-off colors through markup.

## Why Fastify 5

Fastify is the API/server baseline instead of Express.

Reasons:

- schema-first request/response handling;
- bounded serialization contracts;
- response schemas reduce accidental field leakage;
- official type-provider support;
- good fit for narrow local operational APIs.

The dashboard server binds loopback in production behind Cloudflare Tunnel/Access.

## Why TypeBox shared contracts

Use shared runtime schemas from `packages/contracts` so server, agent, frontend adapters and tests do not maintain unrelated runtime validators that can drift.

## Current trust boundaries

### Browser / web API

The browser is untrusted for host authority. The web/API process:

- is Internet-reachable only through the authenticated Cloudflare path;
- binds locally on the RPi5 origin;
- does not own Docker Engine socket access;
- does not expose a generic Docker proxy;
- does not expose arbitrary shell/root capability.

### Main agent

The main `dashboard-rpi5-agent` is the narrow privileged-read evidence bridge over its Unix socket. It owns purpose-built host/systemd/journal/vcgencmd/procfs/sysfs reads and registered diagnostic operations.

It does **not** own Docker Engine socket authority. It has no persistent `docker` or `video` group membership.

Current Docker trust path is:

```text
web/API
  -> main agent
  -> typed bounded Docker broker capability
  -> Docker Engine Unix socket
```

The dedicated Docker broker is the sole Docker Engine authority. It exposes only reviewed current-state/events/log capabilities and never a generic caller-selected Engine endpoint.

### Quick Commands

The accepted production Quick Command catalog is exactly:

```text
host.disk-root
host.failed-units
host.kernel
host.uptime
```

Each ID maps to a fixed executable and fixed argument array with bounded timeout/output. Quick Commands provide neither Docker authority nor free-form terminal authority.

### Terminal agent

Full PTY source is isolated into `apps/terminal-agent` and the corresponding contained systemd socket/service boundary.

Conceptually:

```text
browser
  -> owner-authenticated terminal session/WS gate
  -> local terminal Unix transport
  -> dashboard-rpi5-terminal-agent
  -> contained normal-user PTY
```

The terminal agent must not inherit main-agent privileges, Docker broker authority, root, or automatic sudo. Production terminal/PTTY remains absent/fail-closed until a separate owner-authorized activation.

## Data ownership

```text
Prometheus      = time-series/history
Grafana         = deep visualization
Docker Engine   = authoritative container runtime state/events/logs
Docker broker   = sole bounded transport authority to the Engine socket
systemd/journal = host service state/logs
main agent      = narrow normalized host/local evidence bridge
dashboard       = normalized presentation + attention projection
terminal agent  = separately gated contained PTY boundary
```

Do not create a duplicate metrics database only to redraw existing Prometheus history.

## Deliberately rejected alternatives / regressions

| Alternative | Reason not selected |
|---|---|
| Next.js | SSR/RSC/SEO complexity without sufficient value for this private SPA |
| React Router Framework Mode | unnecessary full-stack framework coupling beside Fastify |
| Express | weaker fit than Fastify's schema/serialization/type-provider model |
| Material UI / Ant Design / Bootstrap | visual override burden or generic appearance |
| Grafana as frontend | cannot provide the required logs/terminal/activity/control UX cleanly |
| Python backend | unnecessary second runtime/toolchain |
| Go agent immediately | no measured performance/footprint requirement yet |
| main agent -> Docker Engine socket | violates the accepted broker-only Docker authority invariant |
| generic Docker proxy | grants host-level authority beyond the reviewed capability set |
| PTY inside privileged-read main agent | would let free-form shell inherit an unrelated privileged evidence boundary |

## Current operational status

The project is no longer a Phase 1 fixture-only implementation. P0–P3 MVP Operator Usable capabilities are accepted in production, including bounded host/Docker current state, registered Docker logs, four fixed read-only Quick Commands and bounded recent Docker events.

The accepted production release can intentionally lag GitHub `main`; a source merge is never production evidence by itself. Terminal/PTTY remains absent/fail-closed.

## Governance

Normal workflow remains:

```text
issue -> fresh main -> fresh branch -> focused change -> Draft PR
-> exact-head CI + manual review -> Ready -> STOP
-> explicit owner squash merge -> exact-main verification
-> classify Production deploy: YES / NO
```

**Merge authorization is not deployment authorization.** Runtime, host, Docker-authority, terminal, systemd, Cloudflare and other production/trust-boundary mutations require their own explicit owner authorization.
