# Stack Decision Summary

Canonical implementation direction for `dashboard_RPi5`:

```text
Node.js 24 LTS
TypeScript strict
npm workspaces

apps/web:
  React
  Vite
  React Router
  TanStack Query
  semantic HTML first
  browser-native controls/primitives first
  plain product CSS + CSS custom-property tokens
  CSS cascade layers
  Lucide
  React Aria only for justified complex widgets
  xterm only for the separately gated Terminal capability

apps/server:
  Fastify 5

apps/agent:
  Fastify 5 / local Unix-socket privileged-read boundary

apps/terminal-agent:
  contained normal-user PTY boundary

packages/contracts:
  TypeBox runtime schemas + Fastify type provider
```

## Current-source caveat

The target architecture and current source are deliberately distinguished. At the time ADR-0007 is introduced, `apps/web` still carries Tailwind import/plugin/dependencies and uses React Aria for the mobile More menu. This documentation does **not** claim those dependencies have already been removed.

Tailwind removal is a follow-up source change only after an exact usage/Preflight audit and web/A55/accessibility regression validation. React Aria remains acceptable where it provides meaningful composite-widget behavior.

## Data/tool scope

```text
Prometheus = metrics/history authority
Grafana    = specialist/deep-analysis option
Dashboard  = daily operations cockpit
```

The dashboard may provide bounded native `1h` / `24h` / `7d` operational history and Top Consumers, but it is not a general PromQL/query/dashboard-composition system and is not committed to replacing Grafana.

Detailed rationale: [`TECH_STACK.md`](TECH_STACK.md).  
Frontend decision: [`adr/0007-html-first-react-plain-css-baseline.md`](adr/0007-html-first-react-plain-css-baseline.md).  
Historical Phase 1 decision: [`adr/0004-phase1-implementation-stack.md`](adr/0004-phase1-implementation-stack.md).  
Master governance/product contract: GitHub issue #1.  
Architecture migration/audit: GitHub issue #282.

The stack choice does not authorize any production deployment or live RPi/Docker/systemd/terminal access.
