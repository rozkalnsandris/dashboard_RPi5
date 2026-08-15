# Phase 1 Implementation Notes

Issue: #3  
Branch: `feat/phase1-core-ui-foundation`

The first implementation slice intentionally contains only fixture-mode product code:

- npm workspaces and strict TypeScript baseline;
- React + Vite + React Router Data Mode shell;
- TanStack Query provider with conservative passive defaults;
- Tailwind 4 + source-owned CSS design tokens;
- React Aria mobile overflow menu;
- desktop sidebar and Samsung A55 bottom navigation;
- responsive Overview and Docker fixture representations;
- placeholder routes for Services, Logs, Terminal, Activity, Backups, Deployments and Settings;
- Fastify `/api/health` fixture endpoint with bounded TypeBox response schema;
- disabled agent workspace with no host capability;
- Playwright reflow/A55-class regression matrix;
- read-only CI bootstrap.

## Explicitly absent

This slice does not connect to or mutate:

- Raspberry Pi host state;
- Docker socket or Engine API;
- Prometheus/Grafana;
- systemd/journal;
- backup jobs;
- shell/PTY;
- Cloudflare;
- `dash.rozkalns.net` production.

The next source step is to stabilize the dependency lock and exact-head CI before extending fixture UX.
