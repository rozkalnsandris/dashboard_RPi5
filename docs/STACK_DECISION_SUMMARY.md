# Stack Decision Summary

Canonical implementation stack for `dashboard_RPi5` Phase 1:

```text
Node.js 24 LTS
TypeScript strict
npm workspaces

apps/web:
  React 19
  Vite 8.1
  React Router 8 Data Mode
  TanStack Query
  shadcn/ui + React Aria base
  Tailwind CSS 4
  CSS custom-property design tokens
  Lucide

apps/server:
  Fastify 5

apps/agent:
  Fastify 5 / local Unix-socket boundary

packages/contracts:
  TypeBox JSON Schemas + Fastify type provider
```

Detailed rationale: [`TECH_STACK.md`](TECH_STACK.md).  
Durable architecture decision: [`adr/0004-phase1-implementation-stack.md`](adr/0004-phase1-implementation-stack.md).  
Implementation tracking: GitHub issue #3.  
Master governance/product contract: GitHub issue #1.

The stack choice does not authorize any production deployment or live RPi/Docker/systemd/terminal access.
