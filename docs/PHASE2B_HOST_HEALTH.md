# Phase 2B — Host read-only health boundary

Issue: #7  
Master contract: #1  
Production deployment: **NO**

## Purpose

Phase 2B adds the first real host-evidence adapter to the source tree. It does **not** activate the agent on the production Raspberry Pi.

The local agent exposes one purpose-built route:

```text
GET /v1/host/summary
```

There is still no generic host command, file, process, systemd, Docker or shell proxy.

## Authoritative evidence sources

| Evidence | Source | Notes |
|---|---|---|
| uptime | `/proc/uptime` | first numeric field |
| load | `/proc/loadavg` | 1m / 5m / 15m |
| CPU usage | `/proc/stat` | aggregate `cpu` line, two monotonic snapshots |
| RAM + swap | `/proc/meminfo` | `MemTotal`, `MemAvailable`, `SwapTotal`, `SwapFree` |
| root filesystem | Node `fs.statfs("/")` | reports blocks available to the service identity |
| SoC temperature | `/usr/bin/vcgencmd measure_temp` | Raspberry Pi firmware signal |
| power/thermal flags | `/usr/bin/vcgencmd get_throttled` | current and occurred-since-boot bit fields |

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

Raspberry Pi documentation recommends `vcgencmd measure_temp` for an accurate instantaneous SoC temperature reading.

The adapter uses the fixed executable:

```text
/usr/bin/vcgencmd
```

and an exact argument array:

```text
["measure_temp"]
```

No shell is used. Output is bounded to 4096 bytes and command execution to 1 second.

Expected response form:

```text
temp=43.2'C
```

Malformed or implausible evidence fails closed.

## `get_throttled` decoding

Raspberry Pi defines these current flags:

| Bit | Meaning |
|---:|---|
| 0 | under-voltage detected |
| 1 | Arm frequency capped |
| 2 | currently throttled |
| 3 | soft temperature limit active |

and matching historical “has occurred” flags at bits 16–19.

The API preserves:

- normalized raw hex;
- raw numeric value;
- four current booleans;
- four occurred-since-boot booleans.

Historical bits must not be presented as a current active incident by the UI.

## Failure model

Every field in a fresh `HostSummary` is required evidence.

If any required source is unreadable, malformed, non-monotonic, times out, exceeds bounds or returns an invalid value, the fresh summary fails as:

```json
{ "error": "SOURCE_UNAVAILABLE" }
```

The route returns HTTP 503. Internal filesystem paths, stderr, command output, stack traces and raw exception strings are not returned to the client.

The dashboard/server layer can later retain a previously proven snapshot and label it stale. Phase 2B itself never fabricates zeroes for missing evidence.

## Activation preflight — future owner gate

Before the first live RPi activation, a separate owner-authorized procedure must verify at minimum:

1. exact merged `main` and exact-main CI;
2. `/usr/bin/node` and `/usr/bin/vcgencmd` paths on the actual Pi;
3. the dedicated service identity can read `/proc/*` and stat `/`;
4. the dedicated service identity can execute both `vcgencmd measure_temp` and `vcgencmd get_throttled`;
5. required VideoCore device permissions are available to the service identity without root/sudo;
6. the Unix socket runtime directory and ownership are correct;
7. no Docker/systemd/journal privilege is introduced accidentally;
8. source-only systemd blueprint hardening is re-reviewed against the actual host.

If `vcgencmd` requires additional group/device permission, that permission change is a separate trust-boundary decision. This source PR does not add a user to `video`, `docker`, `sudo` or any other privileged group.

## Official references checked 2026-08-15

- Raspberry Pi computer hardware / temperature: https://www.raspberrypi.com/documentation/computers/raspberry-pi.html
- Raspberry Pi OS `vcgencmd` and `get_throttled`: https://www.raspberrypi.com/documentation/computers/os.html
- Linux `/proc` filesystem: https://docs.kernel.org/filesystems/proc.html
- Node.js 24 `fs.statfs`: https://nodejs.org/docs/latest-v24.x/api/fs.html

## Explicit non-authorization

This document and its source code do **not** authorize installation, service activation, group changes, device permission changes, Docker access, Cloudflare changes, terminal access or any production/host mutation.

**Production deploy: NO.**
