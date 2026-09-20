# ADR-0004 — Phase 1 implementation stack

**Status:** Accepted historically; frontend-library baseline partially superseded by ADR-0007  
**Date:** 2026-08-15  
**Related:** issue #1, issue #3, issue #282, ADR-0007

> ADR-0007 supersedes the parts of this decision that made Tailwind CSS and shadcn/ui architectural defaults. The still-valid decisions here include Node.js 24 LTS, npm workspaces, TypeScript strict mode, React, Vite, React Router, TanStack Query, Lucide, Fastify and TypeBox. This file is retained as the historical record of the original Phase 1 choice.

## Original decision

Use the following baseline for the first executable implementation of `dashboard_RPi5`:

- Node.js 24 LTS;
- npm workspaces;
- TypeScript strict mode;
- React 19;
- Vite;
- React Router Data Mode;
- TanStack Query for server/telemetry state;
- shadcn/ui source-owned components with React Aria base where appropriate;
- Tailwind CSS 4 as the utility/layout layer;
- CSS custom properties as canonical visual design tokens;
- Lucide icons;
- Fastify 5 for server/API and the local agent boundary;
- TypeBox JSON Schemas + Fastify type provider for shared runtime contracts;
- Recharts only when bounded trend-chart requirements justify it.

Repository layout began with:

```text
apps/web
apps/server
apps/agent
packages/contracts
```

## Context

The application is a private authenticated Raspberry Pi operations dashboard, not a public content/SEO site. It needs a modern desktop interface, a first-class Samsung Galaxy A55 mobile experience, strong request/response contracts and deliberately separated local trust boundaries.

## Rationale that remains valid

### React + Vite

A client-side operations application does not gain enough from SSR/RSC to justify a full Next.js-style framework. Vite keeps the frontend runtime and build boundary explicit.

### React Router

Provides structured route lifecycle/error behavior without taking over the backend/runtime architecture.

### TanStack Query

Fits changing telemetry/server state with explicit stale/refetch/error/cancellation semantics.

### Fastify + TypeBox

Schema-first request/response validation fits the narrow operational API. Shared runtime schemas reduce drift among agent, server, frontend adapters and tests.

### TypeScript first

One primary language/runtime keeps the operational surface smaller. A Go/Rust component should be driven by measured resource/performance/security requirements, not preference.

## Superseded frontend assumptions

The original source-component/Tailwind choice was reasonable for rapid Phase 1 composition but is no longer the durable architecture baseline.

Current guidance is defined by ADR-0007:

- semantic HTML/browser-native controls first;
- plain product CSS + CSS custom properties as the canonical styling model;
- CSS cascade layers for explicit precedence;
- React Aria only where complex accessibility behavior justifies it;
- no shadcn/ui or Tailwind requirement for new UI work;
- Tailwind source removal only after exact dependency/behavior regression evidence.

## Alternatives rejected for initial implementation

- Next.js / SSR / RSC;
- React Router Framework Mode;
- Express;
- Material UI;
- Ant Design;
- Bootstrap;
- Grafana as the product frontend;
- Python backend;
- Go agent from day one.

## Consequences

The project keeps the successful application/runtime decisions while allowing the presentation layer to simplify as source evidence evolves. ADR-0007 is authoritative for new frontend composition/styling work.

## Security boundary

Neither this ADR nor ADR-0007 authorizes Docker socket access, systemd/journal activation, live Prometheus mutation, Quick Command execution changes, PTY activation, Cloudflare changes, production deployment or host/root/container mutation. Those remain separately reviewed owner gates.
