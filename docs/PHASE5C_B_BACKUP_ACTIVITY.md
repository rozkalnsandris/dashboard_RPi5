# Phase 5C-B — structured backup Activity evidence

Issue: #24  
Master contract: #1  
Production deploy: **NO**

## Purpose

Phase 5C-B adds a read-only consumer contract for backup results so the Activity timeline can show backup success/failure without parsing free-form logs or inferring state from file timestamps.

The production backup job is **not** changed or activated by this phase. Until a separately authorized producer writes the structured evidence file, the dashboard must report the backup Activity source as unavailable and render no backup result rows.

## Why the existing log is not authoritative timeline evidence

`RPi5_main/ops/bin/rpi5-backup` writes human-readable log lines using host-local timestamps of the form:

```text
[YYYY-MM-DD HH:MM:SS]
```

Those lines do not carry an offset and are intentionally not converted into exact Activity timestamps. The backup archive contains an internal timezone-bearing manifest, but decrypting/opening backup archives is not an appropriate live dashboard status source.

Phase 5C-B therefore defines a dedicated machine-readable evidence boundary instead of guessing.

## Fixed future producer path

```text
/var/lib/dashboard-rpi5/evidence/backups.json
```

The path is compiled into the local agent reader. Browser requests cannot select a path, file name, log source or timestamp.

## Evidence schema

```json
{
  "schema": "dashboard-rpi5.backup-evidence.v1",
  "runs": [
    {
      "runId": "20260815T020000+0200",
      "startedAt": "2026-08-15T02:00:00+02:00",
      "completedAt": "2026-08-15T02:07:13+02:00",
      "result": "SUCCESS",
      "durationSeconds": 433,
      "sizeBytes": 123456789,
      "exitCode": 0
    }
  ]
}
```

The file contains at most 32 runs. Unknown object fields are rejected.

### Timestamp contract

`startedAt` and `completedAt` must be RFC3339-style timestamps with an explicit timezone (`Z` or `±HH:MM`). A timezone-less local timestamp is invalid.

`completedAt` must not precede `startedAt`. `durationSeconds` must agree with the timestamp difference within a two-second tolerance so stale or contradictory producer output cannot silently enter Activity.

### Result contract

- `SUCCESS` requires `exitCode = 0` and a positive `sizeBytes` value.
- `FAILED` requires a non-zero exit code; size may be unavailable (`null`).

No remote path, archive contents, rclone configuration, Telegram values, arbitrary log message or shell command is accepted by the evidence schema.

## Agent file boundary

The agent uses the fixed evidence path and:

1. opens it read-only with `O_NOFOLLOW`;
2. inspects metadata from the already-open file descriptor;
3. requires a regular file;
4. requires production owner uid `0`;
5. rejects group/world-writable files;
6. rejects files larger than 64 KiB before/while reading;
7. validates the complete JSON contract;
8. returns a bounded, newest-first snapshot;
9. maps missing, malformed, unsafe or oversized evidence to `SOURCE_UNAVAILABLE`.

There is no fallback to `/var/log/rpi5-backup.log`, archive mtime, directory mtime or filename parsing.

Agent route:

```text
GET /v1/backups/recent
```

The route accepts no query selectors and advertises the explicit `backups.recent` capability.

## Dashboard server boundary

The dashboard server reaches only the fixed agent route through the existing Unix socket boundary. Its client has a fixed route, response byte ceiling, wall-clock timeout and full runtime payload validation.

Activity source contract expands to:

```text
DOCKER | SYSTEMD | BACKUP
```

Backup mapping:

- source: `BACKUP`
- kind: `BACKUP_RESULT`
- target: `/backups`
- `SUCCESS` -> `INFO`
- `FAILED` -> `CRITICAL`
- `occurredAt` -> validated `completedAt`
- stable identity -> SHA-256 over the normalized run object
- human text -> derived only from run id, duration, size and exit code

If backup evidence is unavailable while Docker or Services remains valid, `/api/activity` returns the valid sources plus explicit degraded metadata. If all Activity sources fail, the endpoint returns `SOURCE_UNAVAILABLE`.

`/api/activity` remains `Cache-Control: no-store` and accepts no browser selectors.

## UI contract

The Activity page adds a Backups source filter and shows structured backup result rows only when validated producer evidence exists. The UI keeps explicit loading, degraded, empty and unavailable states. Missing producer evidence never becomes a successful-looking backup row.

The existing responsive acceptance matrix remains authoritative, including 320 CSS px and Samsung Galaxy A55 portrait/landscape classes.

## Explicitly not performed by Phase 5C-B

- no creation of `/var/lib/dashboard-rpi5/evidence/backups.json` on the Pi;
- no modification of the production `rpi5-backup` runner;
- no atomic writer installation;
- no owner/group/ACL changes;
- no backup schedule/cron change;
- no systemd activation/restart;
- no production dashboard deploy;
- no endpoint/deployment/maintenance Activity adapter;
- no Phase 6A backup freshness/retention health implementation.

A future producer implementation must write this file atomically and requires a separate owner-approved production/backup-job mutation gate before activation.

**Production deploy: NO.**
