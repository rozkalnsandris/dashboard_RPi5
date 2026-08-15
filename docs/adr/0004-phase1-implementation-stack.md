# ADR-0004 — Phase 1 implementation stack

**Status:** Accepted  
**Date:** 2026-08-15  
**Related:** issue #1, issue #3

## Decision

Use the following baseline for the first executable implementation of `dashboard_RPi5`:

- Node.js 24 LTS;
- npm workspaces;
- TypeScript strict mode;
- React 19;
- Vite 8.1;
- React Router 8 Data Mode;
- TanStack Query for server/telemetry state;
- shadcn/ui source-owned components with React Aria base where appropriate;
- Tailwind CSS 4 as the utility/layout layer;
- CSS custom properties as canonical visual design tokens;
- Lucide icons;
- Fastify 5 for server/API and the local agent boundary;
- TypeBox JSON Schemas + Fastify type provider for shared runtime contracts;
- Recharts v3 only when bounded trend-chart requirements arrive.

Repository layout begins with:

```text
apps/web
apps/server
apps/agent
packages/contracts
```

## Context

The application is a private authenticated Raspberry Pi operations dashboard, not a public content/SEO site. It needs a modern desktop interface, a first-class Samsung Galaxy A55 mobile experience, strong request/response contracts and a deliberately separated local privileged-read boundary.

## Rationale

### React + Vite

A client-side operations application does not gain enough from SSR/RSC to justify a full Next.js-style framework. Vite keeps the frontend runtime and build boundary explicit.

### React Router Data Mode

Provides loaders, pending/error state and structured route lifecycles without taking over the backend/runtime architecture.

### TanStack Query

Fits changing telemetry/server state with explicit stale/refetch/error/cancellation semantics.

### shadcn/ui + React Aria

Provides source-owned components with strong accessible/touch interaction primitives while preserving complete control over the custom `dashboard_RPi5` visual system.

### Tailwind CSS 4 + CSS variables

Tailwind accelerates responsive layout/container-query work. CSS variables remain authoritative for branding/status tokens so the project does not become visually coupled to utility defaults.

### Fastify + TypeBox

Schema-first request and response validation is a better fit than an untyped/general-purpose API layer. Shared schemas reduce drift between agent, server, frontend and tests.

### TypeScript agent first

One language/runtime keeps the initial operational surface smaller. A rewrite of the agent to Go/Rust must be driven by measured resource/performance/security requirements, not preference.

## Alternatives rejected for initial implementation

- Next.js / SSR / RSC;
- React Router Framework Mode;
- Express;
- Material UI;
- Ant Design;
- Bootstrap;
- fully custom component library from scratch;
- Grafana as the product frontend;
- Python backend;
- Go agent from day one.

See `docs/TECH_STACK.md` for detailed rationale and boundaries.

## Consequences

Positive:

- one primary language/toolchain;
- high-quality mobile/accessibility primitives;
- easy custom visual design;
- runtime API validation;
- clear local agent trust boundary;
- straightforward testing and CI.

Costs:

- multiple libraries must remain intentionally scoped;
- shadcn source code becomes our maintenance responsibility;
- Tailwind utility use must stay disciplined around shared tokens/components;
- Node runtime on the Pi must be managed as part of deployment later.

## Security boundary

This ADR does **not** authorize:

- Docker socket access;
- systemd/journal access;
- live Prometheus reads;
- Quick Command execution;
- PTY terminal activation;
- Cloudflare/DNS/Access changes;
- production deployment;
- host/root/container mutation.

Those remain later explicit phase/owner gates.
