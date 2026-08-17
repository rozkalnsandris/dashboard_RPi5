# Phase 2B — Host read-only health boundary

Issue: #7  
Master contract: #1  
Production deployment: **NO**

## Purpose

Phase 2B adds the first real host-evidence adapter to the source tree. It does **not** by itself authorize agent activation or privilege expansion on the production Raspberry Pi.

The local agent exposes one purpose-built route:

```text
GET /v1/host/summary
```

There is no generic host command, file, process, systemd, Docker or shell proxy.

## Authoritative evidence sources

| Evidence | Source | Required | Notes |
|---|---|---:|---|
| uptime | `/proc/uptime` | yes | first numeric field |
| load | `/proc/loadavg` | yes | 1m / 5m / 15m |
| CPU usage | `/proc/stat` | yes | aggregate `cpu` line, two monotonic snapshots |
| RAM + swap | `/proc/meminfo` | yes | `MemTotal`, `MemAvailable`, `SwapTotal`, `SwapFree` |
| root filesystem | Node `fs.statfs("/")` | yes | blocks available to the service identity |
| SoC temperature | `/sys/class/thermal/thermal_zone0/temp` | yes | unprivileged kernel thermal-zone signal, millidegrees Celsius |
| power/thermal flags | `/usr/bin/vcgencmd get_throttled` | no | current and occurred-since-boot firmware bit fields; explicit unavailable state when the mailbox cannot be read |

Prometheus remains the planned historical time-series authority. These reads are for a current local snapshot, not a second metrics database.

## CPU semantics

The aggregate first `cpu` line from `/proc/stat` is sampled twice with a fixed 200 ms window.

Phase 2B uses the first eight counters:

```text
user nice system idle iowait irq softirq steal
```

`guest` and `guest_nice` are not added because guest time is already included in user/nice accounting.

The second snapshot must be monotonic for every included counter and total delta must be positive. Invalid evidence fails closed with `SOURCE_UNAVAILABLE`; it is not converted to `0%`.

## Memory semantics

Memory availability is based on Linux `MemAvailable`, not `MemFree`.

```text
usedBytes = MemTotal - MemAvailable
```

Swap reports `swapUsedPercent = null` when `SwapTotal` is zero. This distinguishes “swap disabled/not configured” from a misleading `0% used` metric.

## Filesystem semantics

`fs.statfs("/")` is called with bigint output. Capacity math remains bigint until safe conversion to JSON numbers.

The UI-facing available capacity is based on `bavail` — blocks available to the unprivileged dashboard service identity — rather than privileged free blocks.

```text
totalBytes     = bsize * blocks
availableBytes = bsize * bavail
usedBytes      = totalBytes - availableBytes
```

## Raspberry Pi temperature

Production evidence from #117 showed that the dedicated agent can read ordinary kernel host evidence but cannot open `/dev/vcio`, which is intentionally not made available through a new privileged supplementary group.

Temperature therefore uses the fixed unprivileged kernel path:

```text
/sys/class/thermal/thermal_zone0/temp
```

The source is parsed strictly as a signed integer number of millidegrees Celsius. For example:

```text
43200
```

becomes `43.2°C`.

Malformed, missing or implausible temperature evidence remains a required-source failure and returns `SOURCE_UNAVAILABLE`. The implementation does not fall back to fabricated data or to privilege expansion.

## `get_throttled` decoding and availability

Raspberry Pi firmware defines these current flags:

| Bit | Meaning |
|---:|---|
| 0 | under-voltage detected |
| 1 | Arm frequency capped |
| 2 | currently throttled |
| 3 | soft temperature limit active |

and matching historical “has occurred” flags at bits 16–19.

When firmware evidence is readable, the API preserves the existing available payload:

- normalized raw hex;
- raw numeric value;
- four current booleans;
- four occurred-since-boot booleans.

When the firmware mailbox is inaccessible or `get_throttled` output is malformed, the API returns only:

```json
{ "state": "UNAVAILABLE" }
```

It must never fabricate `0x0`, `false` flags or a healthy-looking “None” state when firmware evidence was not observed.

Historical bits must not be presented as a current active incident by the UI.

## Failure model

CPU/load, memory, uptime, filesystem and sysfs temperature remain required evidence. If one of those sources is unreadable, malformed, non-monotonic, times out or returns an invalid value, the fresh summary fails as:

```json
{ "error": "SOURCE_UNAVAILABLE" }
```

The route returns HTTP 503. Internal filesystem paths, stderr, command output, stack traces and raw exception strings are not returned to the client.

Throttle firmware evidence is the one explicitly degradable field because production least-privilege evidence proved that granting `/dev/vcio` access would widen the agent trust boundary. Its absence is represented as `UNAVAILABLE`, and the UI must raise an attention signal rather than showing an all-clear throttle state.

The dashboard/server layer can retain a previously proven snapshot and label it stale. Phase 2B never fabricates zeroes for missing evidence.

## Production trust boundary

The main read agent must not be added to `video` merely to make `vcgencmd` work. Device permissions must not be broadened as a side effect of host telemetry collection.

Any future decision to grant firmware-mailbox access is a separate owner-authorized trust-boundary change and must be reviewed independently.

Docker access is also separate and remains governed by its own trust boundary; this host-health remediation does not grant the main agent Docker socket access.

## Validation requirements

Focused regression coverage must prove:

1. strict sysfs millidegree parsing;
2. missing/malformed sysfs temperature fails the host summary;
3. inaccessible or malformed throttle evidence produces exactly `{ "state": "UNAVAILABLE" }`;
4. unavailable throttle evidence does not hide CPU/RAM/load/uptime/filesystem/temperature;
5. available `get_throttled` evidence keeps the decoded current/historical contract;
6. the UI labels unavailable throttle evidence and prevents a false “All clear” state;
7. no fixture/default substitution is introduced.

## Official references

- Raspberry Pi computer hardware / temperature: https://www.raspberrypi.com/documentation/computers/raspberry-pi.html
- Raspberry Pi OS `vcgencmd` and `get_throttled`: https://www.raspberrypi.com/documentation/computers/os.html
- Linux thermal sysfs ABI / thermal framework: https://docs.kernel.org/driver-api/thermal/sysfs-api.html
- Linux `/proc` filesystem: https://docs.kernel.org/filesystems/proc.html
- Node.js `fs.statfs`: https://nodejs.org/docs/latest-v24.x/api/fs.html

## Explicit non-authorization

This document and its source code do **not** authorize installation, service activation/restart, group changes, device permission changes, Docker access, Cloudflare changes, terminal access or any production/host mutation.

**Production deploy: NO.**
