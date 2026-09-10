# Issue 265 — container-metrics source readiness

Parent: #247  
Canonical continuity: #213  
Durable security authority: #1

## Purpose

Per-container historical charts require a Prometheus-compatible container metrics source that does not weaken the existing Docker Engine authority boundary. This child records the production measurement, fixes the source-level acceptance contract and stops before collector deployment, Prometheus configuration, or any host/runtime mutation.

The machine-readable contract is [`ops/production/container-metrics-source-contract.json`](../ops/production/container-metrics-source-contract.json).

**Production deploy: NO.**

## Read-only production baseline

A read-only measurement on 2026-09-10 observed:

- 20 running Docker containers;
- no cAdvisor/container collector container;
- exactly one active Prometheus job, `node`, healthy at a 15 s scrape interval;
- no Prometheus metric names matching `container_*` or broader Docker/container/cAdvisor naming;
- effective Prometheus retention of `15d or 2GiB`, with corruption count `0`.

This baseline is provenance for the source decision, not a claim about future runtime state. Any later activation decision must refresh live evidence.

The result is fail-closed: #247 must not add per-container history API/UI queries as though the required series already existed.

## Required history capabilities

The source contract fixes the initial candidate metric families needed by the product:

| Capability | Accepted metric family | Query requirement |
|---|---|---|
| CPU | `container_cpu_usage_seconds_total` | rate; aggregate raw `cpu` dimension |
| memory | `container_memory_working_set_bytes` | gauge |
| network receive | `container_network_receive_bytes_total` | rate; aggregate `interface` |
| network transmit | `container_network_transmit_bytes_total` | rate; aggregate `interface` |
| filesystem read | `container_fs_reads_bytes_total` | rate; aggregate `device` |
| filesystem write | `container_fs_writes_bytes_total` | rate; aggregate `device` |

These names describe the reviewed source capability expected from a cAdvisor-compatible candidate. They do not select, deploy, or activate cAdvisor.

For each public container metric, the server-owned query registry must reduce raw collector dimensions to exactly one logical series per dashboard container before the existing history normalizer accepts the result. The browser still cannot supply PromQL, label matchers, arbitrary time bounds, scrape targets, or collector URLs.

## Stable container identity

Historical identity is stricter than a raw runtime container ID. A container recreate changes the Docker ID, while the product needs a reviewed rule for whether history before and after recreation represents the same logical dashboard container.

Before activation, read-only live evidence must prove the selected collector exposes enough stable identity to derive a server-owned logical container key. The implementation must explicitly define recreate continuity and must not use an opaque raw container ID as the public history key.

Collector/Docker metadata must also remain bounded:

- export only reviewed labels needed for identity/querying;
- do not export environment variables as labels;
- do not accept arbitrary/unbounded Docker label export;
- do not return raw collector labels to the browser.

If stable identity cannot be established without widening an existing trust boundary, the container-history lane remains unavailable until a separately reviewed architecture/security decision resolves it.

## Docker Engine authority gate

[`ADR 0005`](adr/0005-docker-broker-only-engine-authority.md) makes `dashboard-rpi5-docker-broker` the sole Docker Engine/socket authority for dashboard-owned runtime reads. Neither the main agent nor the server may regain direct daemon access.

cAdvisor is only a candidate. Its upstream Docker integration defaults `--docker` to `unix:///var/run/docker.sock`. A cAdvisor deployment that mounts or connects to that socket would therefore create another Docker Engine authority path and conflicts with the currently accepted repository boundary.

Issue #265 does not authorize that expansion. The source contract explicitly forbids collector Docker-socket access/mounting. If a selected collector cannot satisfy the required metric/identity contract without Docker Engine socket access, work must stop at a separate ADR/security/owner decision rather than adding a runtime workaround.

Upstream references reviewed for the source decision:

- cAdvisor runtime options: <https://github.com/google/cadvisor/blob/master/docs/runtime_options.md>
- cAdvisor Docker factory: <https://github.com/google/cadvisor/blob/master/container/docker/factory.go>
- cAdvisor Prometheus metrics: <https://github.com/google/cadvisor/blob/master/docs/storage/prometheus.md>

## Prometheus and browser boundary

An eventual collector is an internal Prometheus scrape source, not a new public API.

The existing rules remain:

- Prometheus is queried only by the dashboard server through fixed registered expressions;
- the browser cannot query Prometheus or the collector directly;
- collector labels and upstream error bodies are not public response data;
- no arbitrary PromQL or arbitrary label matcher is accepted from browser input;
- activation must not expose a collector endpoint at the public edge.

The currently observed `15d or 2GiB` retention satisfies the product's 7-day range by time, but a future live preflight must re-check effective retention and capacity evidence instead of treating the 2026-09-10 observation as permanent runtime truth.

## Future LIVE activation evidence

Collector deployment, Docker/container changes, Prometheus target/config changes, networking, mounts, permissions, and restarts are separate LIVE mutations and require explicit owner authorization.

After a separately authorized activation, read-only acceptance evidence must prove all of the following before container-history API/UI work can claim runtime readiness:

1. every required metric family is emitted;
2. stable logical container identity is proved for the intended containers;
3. raw label cardinality is bounded and reviewed;
4. the server-owned aggregation yields one logical series per container for every metric;
5. the Prometheus scrape target is healthy;
6. effective retention still covers the 7-day product range;
7. Docker Engine authority remains exclusive to `dashboard-rpi5-docker-broker`.

A failure of any item leaves the source unavailable. Missing evidence is not zero and is not permission to broaden the source dynamically.

## Explicit exclusions

This child does not add:

- a cAdvisor/container manifest or running collector;
- Docker socket/group/permission changes;
- Prometheus scrape, retention, storage, or runtime configuration;
- systemd/network/Cloudflare changes;
- per-container history API/query registry entries;
- per-container history UI;
- Grafana retirement;
- production deployment or restart.

**Production deploy: NO.**
