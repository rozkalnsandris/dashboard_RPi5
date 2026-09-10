# Data Sources and Metric Contract

## Principle

Use the authoritative source that already owns the data. Avoid duplicate collectors and duplicate history stores.

| Data | Primary source | UI use |
|---|---|---|
| Host CPU | Prometheus/node_exporter | current + history |
| Load average | Prometheus/node_exporter or `/proc/loadavg` | current/detail |
| RAM/swap | Prometheus/node_exporter | current + history |
| Root filesystem | Prometheus/node_exporter | current + history |
| Disk I/O | Prometheus/node_exporter | history/topology |
| Network | Prometheus/node_exporter | current + history |
| SoC temperature | `/sys/class/thermal/thermal_zone0/temp` for local current state | exact current Pi temperature |
| Thermal/power flags | `vcgencmd get_throttled` when the firmware mailbox is readable | current + since-boot evidence, otherwise explicit unavailable |
| Docker live stats | Docker Engine stats API | CPU/RAM/net/block/PIDs |
| Container history | Prometheus scraping a broker-backed Prometheus exporter after separate LIVE activation | per-container history after source-readiness + activation gates |
| Docker lifecycle | Docker Engine events API | activity timeline |
| Docker logs | Docker Engine logs API | log explorer |
| systemd state | `systemctl show`/systemd interface | allowlisted service status |
| service logs | journal | structured log explorer |
| Backups | controlled job evidence + optional node_exporter textfile metrics | freshness/history |
| Deep metrics | Grafana | external deep link |

## Docker data ownership versus transport

Docker Engine remains the authoritative owner of container runtime state, lifecycle events and Docker logs. That does **not** mean the main agent owns Docker daemon authority.

The accepted transport/security boundary is:

```text
web/API
  -> dashboard-rpi5-agent
  -> typed bounded broker capabilities
  -> /run/dashboard-rpi5-docker-broker/broker.sock
  -> dashboard-rpi5-docker-broker
  -> /var/run/docker.sock
```

Only the dedicated broker may reach the Docker Engine Unix socket. The main `dashboard-rpi5-agent` has no persistent `docker` or `video` membership and must not regain direct Docker socket access merely to satisfy a read capability. The broker is not a generic Engine proxy: current-state, registered logs and recent events are explicit bounded capabilities, and unknown paths or unsupported capability parameters fail closed.

See [`docs/adr/0005-docker-broker-only-engine-authority.md`](adr/0005-docker-broker-only-engine-authority.md).

## Raspberry Pi-specific health

Decode `get_throttled` rather than showing only hex when firmware evidence is available.

Relevant flags include current and historical evidence for:

- under-voltage;
- Arm frequency capped;
- throttling;
- soft temperature limit.

The production read agent does not gain `video` membership merely to access `/dev/vcio`. If the firmware mailbox is inaccessible, throttle evidence is reported as `UNAVAILABLE`; the dashboard must not manufacture `0x0` or a healthy-looking all-clear state.

Current SoC temperature uses the unprivileged kernel thermal-zone signal at `/sys/class/thermal/thermal_zone0/temp`, parsed strictly from millidegrees Celsius. Missing or malformed temperature remains a required-source failure.

Temperature is displayed with the actual value and a textual state. Threshold configuration belongs server-side.

## Docker current metrics

Expose normalized values for:

- CPU %;
- memory usage;
- memory limit;
- memory %;
- network RX/TX;
- block read/write;
- PIDs.

The API and CLI differ in how Linux memory cache is reported; normalization must be documented and tested so the dashboard does not compare unlike values.

Docker daemon access is a separate high-privilege boundary. Read-only intent at the Docker HTTP method level does not make direct daemon access low privilege. The main agent consumes only the typed broker protocol; the dedicated broker remains the sole Docker Engine authority and must never become a generic passthrough API.

## Container history source readiness

Container history is a distinct ownership/transport path from Docker live stats. Historical series belong in Prometheus. Issue #265 established the container-metrics source-readiness gate, and #267 now selects the source architecture without activating it.

The selected path is a **broker-backed Prometheus exporter**:

```text
Prometheus
  -> bounded container-metrics exporter
      -> fixed typed broker capability
          -> dashboard-rpi5-docker-broker
              -> Docker Engine Unix socket
```

Docker broker remains the sole Docker Engine authority. The exporter must not receive Docker socket access/mounts, `docker` group membership, Docker TCP credentials, arbitrary Engine endpoint selection or a generic Docker proxy. The fixed metrics capability and exporter runtime are not implemented by the #267 architecture-decision child.

The primary stable history identity is the validated Docker Compose tuple `project/service/container-number`. Container name and raw Docker ID are not automatic recreate-continuity fallbacks. Missing, partial, malformed or duplicate Compose identity remains `UNAVAILABLE` unless a separate server-owned, source-reviewed bounded static mapping exists.

The 2026-09-10 read-only identity evidence recorded by #267 observed 20 containers, 19 complete unique Compose tuples, zero duplicate complete tuples and one container with none of the selected Compose labels. This is historical provenance only, not current runtime truth. Fresh evidence is mandatory before any later LIVE activation.

Required CPU, memory, network RX/TX and filesystem read/write families remain fixed in `ops/production/container-metrics-source-contract.json`, with bounded label cardinality and one logical series per container after reviewed server-owned aggregation.

The browser remains outside the collector/Prometheus trust boundary: queries are fixed server-side, raw collector labels are not public output and arbitrary PromQL or label matchers remain forbidden.

See [`docs/ISSUE265_CONTAINER_METRICS_SOURCE_READINESS.md`](ISSUE265_CONTAINER_METRICS_SOURCE_READINESS.md), [`ADR-0006`](adr/0006-broker-backed-container-metrics-exporter.md) and `ops/production/container-metrics-source-contract.json`.

Collector/exporter deployment, broker runtime capability activation, Prometheus scrape/retention mutation, Docker permission changes, systemd/container changes and restarts remain separate explicit LIVE owner gates.

## Refresh cadence starting point

| Data | Visible page | Hidden tab |
|---|---:|---:|
| host summary | 5–10s | 30–60s |
| Docker current stats | 5–10s | 30–60s |
| endpoint summary | 15–30s | 60s+ |
| backups/updates | 60s | several min |
| history charts | on-view / 30–60s | paused |
| activity | stream or 10–15s | slower |
| logs | explicit stream | paused |

Never overlap passive polling requests indefinitely. Abort stale requests and back off on failure.

## Stale and unavailable state

Missing evidence is not zero.

Examples:

```text
CPU: unavailable
Throttle: unavailable
Docker: stale · last seen 4m ago
Backup: unknown
Agent: unavailable
```

If required health inputs are stale/unavailable, overall state cannot remain falsely `Healthy`. A partially unavailable field such as throttle evidence must be surfaced as attention while independently trustworthy host metrics remain usable.
