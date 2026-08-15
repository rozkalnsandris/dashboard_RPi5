# Phase 6A — Backup health, freshness and retention

Phase 6A turns the existing structured backup-run evidence into a first-class read-only Backups view. It does not change the host backup job and does not create the live evidence producer.

## Source-of-truth policy

The reviewed backup behavior is owned by `rozkalnsandris/RPi5_main`:

- `docs/V10_BACKUP_OWNERSHIP_CONTRACT.md` preserves encrypted Google Drive upload, local retention of seven days, remote retention of thirty days and nightly execution at 02:00;
- `ops/cron.d/rpi5-backup` contains the reviewed `0 2 * * *` root cron entry;
- `ops/backup/rpi5-backup.conf.example` records the retention values while keeping real credentials and runtime secrets outside Git.

The dashboard deliberately exposes only browser-safe static policy labels:

- destination: `Encrypted Google Drive`;
- schedule: `Daily at 02:00 host local time`;
- local retention: 7 days;
- remote retention: 30 days;
- dashboard freshness budget: 30 hours.

The 30-hour freshness budget is a dashboard alerting policy. It is not a change to the production schedule or retention policy.

## Evidence path

Phase 6A reuses the existing Phase 5C-B agent evidence route:

`GET /v1/backups/recent`

The underlying agent reader remains bound to the fixed internal structured evidence file and retains its existing `O_NOFOLLOW`, regular-file, owner, mode, byte-cap and strict-schema checks.

The browser never receives that path and cannot select another file or source.

## Browser API

The server exposes one purpose-built endpoint:

`GET /api/backups`

It accepts no query parameters and returns `Cache-Control: no-store`.

The response contains:

- server observation time;
- normalized health: `HEALTHY | ATTENTION | UNKNOWN`;
- freshness: `FRESH | STALE | UNKNOWN`;
- latest validated run or null;
- latest successful completion time or null;
- derived successful-backup age or null;
- reviewed browser-safe policy metadata;
- bounded validated history.

Private archive paths, rclone remote paths, rclone configuration, age key locations, credentials and archive filenames are not part of the contract.

## Health semantics

- source failure -> API `SOURCE_UNAVAILABLE`; UI state remains unknown;
- valid empty history -> `UNKNOWN`;
- latest completed run failed -> `ATTENTION`;
- latest successful run older than 30 hours -> `ATTENTION` + `STALE`;
- latest completed run successful and last success age <= 30 hours -> `HEALTHY` + `FRESH`.

A failed latest run remains `ATTENTION` even when an earlier successful run is still within the freshness budget.

The server rejects backup completions in the future relative to its observation clock. The shared browser parser re-derives age, freshness and health from the returned history and rejects inconsistent responses.

## UI

`/backups` shows:

- overall backup state and freshness;
- latest result;
- last-success age;
- duration and size;
- reviewed destination and schedule labels;
- retention values;
- bounded recent run history;
- explicit loading, unavailable and empty states.

Overview consumes the same `/api/backups` query. Failure or staleness is surfaced as `Backup needs attention`. Missing or empty evidence is shown as unknown and is never collapsed into an all-clear state. The old Phase 1 fixture all-clear card is hidden in the composed Overview once the live backup status component is present.

## Explicit non-goals

Phase 6A does not:

- create `/var/lib/dashboard-rpi5/evidence/backups.json` on the host;
- modify the backup script or evidence producer;
- run a backup;
- change cron, retention, rclone, encryption, keys, logs or host permissions;
- expose raw backup configuration or secrets;
- deploy the dashboard.

Any live producer installation or dashboard production deployment remains a separate owner-authorized operation.

**Production deploy: NO.**
