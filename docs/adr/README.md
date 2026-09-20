# Architecture Decision Records

- [`0001-standalone-repository-and-hostname.md`](0001-standalone-repository-and-hostname.md) — standalone `dashboard_RPi5` repository and `dash.rozkalns.net`.
- [`0002-local-agent-boundary.md`](0002-local-agent-boundary.md) — separate local privileged-read agent boundary.
- [`0003-read-only-first.md`](0003-read-only-first.md) — observability before terminal/write capability.
- [`0004-phase1-implementation-stack.md`](0004-phase1-implementation-stack.md) — original Node/TypeScript + React/Vite/Fastify stack; frontend library assumptions are partially superseded by ADR-0007.
- [`0005-docker-broker-only-engine-authority.md`](0005-docker-broker-only-engine-authority.md) — dedicated bounded Docker broker is the sole Docker Engine authority.
- [`0006-broker-backed-container-metrics-exporter.md`](0006-broker-backed-container-metrics-exporter.md) — historical container metrics use a Prometheus exporter backed only by bounded Docker-broker capability and Compose tuple identity.
- [`0007-html-first-react-plain-css-baseline.md`](0007-html-first-react-plain-css-baseline.md) — HTML-first React, browser-native behavior and plain product CSS are the durable frontend baseline; Tailwind/shadcn are no longer architectural defaults.
