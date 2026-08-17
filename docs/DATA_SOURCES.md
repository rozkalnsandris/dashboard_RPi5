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
| Docker lifecycle | Docker Engine events API | activity timeline |
| Docker logs | Docker Engine logs API | log explorer |
| systemd state | `systemctl show`/systemd interface | allowlisted service status |
| service logs | journal | structured log explorer |
| Backups | controlled job evidence + optional node_exporter textfile metrics | freshness/history |
| Deep metrics | Grafana | external deep link |

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

Docker daemon access is a separate high-privilege boundary. The main read agent must not be placed in the `docker` group merely to satisfy current-state reads; any Docker access design must preserve the no-generic-proxy contract and be separately reviewed.

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
