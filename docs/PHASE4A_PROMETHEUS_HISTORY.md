# Phase 4A — Prometheus history read boundary

Issue: #14  
Master contract: #1

## Purpose

Phase 4A adds the first dashboard-server history boundary without creating another metrics store. Prometheus remains authoritative for time-series history; Grafana remains the deep-analysis UI.

This phase is source-only. It does not configure production Prometheus/Grafana addresses and does not change the Raspberry Pi host.

## Public API

```text
GET /api/history/host?range=1h|24h|7d
```

The browser can choose only a preset range. It cannot send PromQL, arbitrary timestamps, step sizes, label matchers, upstream URLs or Grafana destinations.

## Presets

| Range | Step | Maximum points per series |
|---|---:|---:|
| `1h` | 30 s | 121 |
| `24h` | 5 min | 289 |
| `7d` | 30 min | 337 |

The server owns `end=now` and derives the start time.

## Initial host series

The server owns a fixed PromQL registry for:

- `CPU_PERCENT`;
- `MEMORY_PERCENT`;
- `ROOT_FS_PERCENT`;
- `LOAD1`.

An optional node-exporter `instance` value is server configuration only. It is escaped as a label value and is never accepted from browser input.

## Prometheus transport

The transport:

- uses only HTTP(S);
- rejects URL credentials, query strings, fragments and non-root base paths;
- always calls `/api/v1/query_range`;
- uses server-owned query/start/end/step;
- sends a fixed query timeout and a one-series result limit;
- enforces a 3 s transport timeout;
- enforces a 2 MiB response cap;
- supports cancellation;
- does not expose upstream error bodies.

Prometheus matrix labels and raw PromQL are not returned to the browser.

## Normalization

A registered metric returns either:

```text
AVAILABLE
UNAVAILABLE
```

`UNAVAILABLE` is used for a valid empty matrix or when all samples are Prometheus non-finite markers (`NaN`, `+Inf`, `-Inf`). No zero is fabricated.

Malformed envelopes, wrong result types, more than one returned series, out-of-window timestamps, non-monotonic timestamps, oversized point sets or finite values outside the metric domain fail closed as a source error.

## Grafana link

The normalized snapshot may include `grafanaHref`.

The link is emitted only when both server-side values are valid:

- credential-free HTTP(S) Grafana root URL;
- relative `/d/<uid>/<slug>` dashboard path.

The server appends only:

```text
from=now-1h|now-24h|now-7d
to=now
```

Invalid or incomplete Grafana configuration yields `grafanaHref: null`.

## Environment contract

Source code recognizes these optional server-side values:

```text
DASHBOARD_PROMETHEUS_URL
DASHBOARD_PROMETHEUS_NODE_INSTANCE
DASHBOARD_GRAFANA_URL
DASHBOARD_GRAFANA_HOST_DASHBOARD_PATH
```

They are not secrets and no production values are committed in this phase. Production wiring remains a separate owner-gated action.

## Official references checked 2026-08-15

- Prometheus HTTP API: https://prometheus.io/docs/prometheus/latest/querying/api/
- Prometheus query basics: https://prometheus.io/docs/prometheus/latest/querying/basics/
- Grafana dashboard URL variables: https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/create-dashboard-url-variables/
- Grafana dashboard links: https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/manage-dashboard-links/

## Explicit exclusions

Phase 4A does not include React charts, top-consumer UI, cAdvisor, arbitrary PromQL, Prometheus writes/admin APIs, Grafana tokens, agent activation, Docker permission changes, Cloudflare changes or any host/production mutation.

**Production deploy: NO.**
