# Phase 5C-D — verified deploy Activity

Status: source-only implementation. Production deploy: **NO**.

## Purpose

Phase 5C-D adds successful controlled-deploy verification to the dashboard Activity timeline without weakening the V12 controlled-deploy trust boundary in `rozkalnsandris/RPi5_main`.

The V12 engine keeps transaction metadata and `latest-success` under `/var/lib/rpi5-deploy` as root-private state. The dashboard agent does not read that directory, does not use sudo and does not change permissions or ACLs.

## Authoritative producer

`RPi5_main/scripts/rpi5_deploy_tx.py` writes a successful transaction only after:

1. every managed target matches its reviewed desired fingerprint;
2. validators pass;
3. final target verification passes;
4. host preflight passes;
5. transaction metadata is atomically updated to `status=success` with `completed_at`;
6. `latest-success` is atomically updated.

Only then it calls the V12 log helper with:

`DEPLOY PASS transaction=<txid> commit=<12hex>`

`rpi5_deploy_lib.py` sends the same concise marker through `logger -t rpi5-deploy -- ...` when `logger` is available.

## Dashboard evidence boundary

The Activity reader uses a fixed `/usr/bin/journalctl` argv. Browser input cannot influence executable, tag, UID, transport, time window, fields or line count.

Fixed matches:

- `_UID=0`
- `_TRANSPORT=syslog`
- `SYSLOG_IDENTIFIER=rpi5-deploy`

Fixed output fields:

- `__REALTIME_TIMESTAMP`
- `_UID`
- `_TRANSPORT`
- `SYSLOG_IDENTIFIER`
- `MESSAGE`

The reader accepts an Activity event only when `MESSAGE` exactly matches:

`^DEPLOY PASS transaction=(\d{8}T\d{12}Z-([0-9a-f]{12})) commit=([0-9a-f]{12})$`

and the transaction suffix equals the printed commit. Journal microseconds become canonical UTC ISO time. Duplicate identical transaction evidence is collapsed; conflicting duplicate evidence fails closed.

A successful journal query with no matching PASS records is **available empty history**, not unavailable.

## What is deliberately not inferred

`DEPLOY FAIL transaction=...; automatic rollback starting` proves only that the apply path entered rollback. It does not prove the final rollback result. The authoritative final states (`rolled_back`, `rollback_failed`, manual rollback states) remain in root-private transaction metadata. Phase 5C-D therefore does not create failed-deploy Activity rows from that message.

Manual rollback Activity is also deferred.

## Human follow-up logs

`journal:rpi5-deploy` is a registered Logs source with the same fixed root/syslog/tag filter. It provides bounded human-readable V12 markers without exposing an arbitrary journal selector.

## API and UI

Agent route: `GET /v1/deploy/events/recent` with no query parameters.

Activity source: `DEPLOY`.

Activity kind: `DEPLOY_VERIFIED`.

Severity: `INFO`.

Title: `Deploy verified`.

Target: `/logs`.

The Activity source set is now Docker, Services, Backup, Maintenance and Deploy. Partial source failure remains degraded; only failure of all five sources returns source unavailable.

## Operational boundary

This phase does not:

- deploy anything;
- install or mutate the V12 deploy engine;
- read root-private deploy files;
- change journal permissions/groups/ACLs;
- grant the dashboard agent sudo or root;
- expose repository paths, target fingerprints or deploy error text;
- infer failed-deploy final outcomes;
- implement endpoint-state Activity.
