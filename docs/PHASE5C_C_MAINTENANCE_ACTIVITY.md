# Phase 5C-C — Structured maintenance Activity

Phase 5C-C extends the read-only Activity timeline with completed `rpi5-update.service` outcomes derived from systemd manager journal metadata.

This is a **source-only** change. It does not install or enable the updater service/timer, change the updater, alter journal permissions, mutate the host, or deploy the dashboard.

## Why systemd manager evidence

`RPi5_main/ops/bin/rpi5-update` writes human-oriented log text with host-local bracketed timestamps. That text is useful for diagnostics but is not a safe Activity event contract because it is free-form and does not carry an explicit timezone.

`RPi5_main/ops/systemd/rpi5-update.service` is a reviewed `Type=oneshot` unit. systemd v252 emits stable structured manager records for completed unit outcomes, including a unit identifier, invocation identifier, manager message identifier, realtime journal timestamp, and failure result where applicable. Phase 5C-C consumes only those structured fields.

## Fixed structured evidence

Only this unit is accepted:

- `rpi5-update.service`

Only these systemd manager `MESSAGE_ID` values are accepted:

- `7ad2d189f7e94e70a38c781354912448` — unit deactivated successfully;
- `d9b373ed55a64feb8242e02dbe79a49c` — unit failed with a structured result.

The agent executes exactly `/usr/bin/journalctl` with fixed arguments:

```text
--no-pager
--output=json
--output-fields=__REALTIME_TIMESTAMP,MESSAGE_ID,UNIT,INVOCATION_ID,UNIT_RESULT
--since=-7d
--lines=64
UNIT=rpi5-update.service
_PID=1
MESSAGE_ID=7ad2d189f7e94e70a38c781354912448
MESSAGE_ID=d9b373ed55a64feb8242e02dbe79a49c
```

There is no browser-controlled unit, message ID, time range, executable, path, or shell fragment.

## Structured normalization

Every accepted record must contain:

- exact `UNIT=rpi5-update.service`;
- one of the two fixed manager `MESSAGE_ID` values;
- a lowercase 32-hex `INVOCATION_ID`;
- decimal `__REALTIME_TIMESTAMP` journal microseconds;
- for failure only, a bounded safe `UNIT_RESULT` token.

Successful records normalize to:

- result `SUCCESS`;
- `unitResult = null`;
- Activity severity `INFO`;
- title `Maintenance completed`.

Failure records normalize to:

- result `FAILED`;
- bounded structured `unitResult`;
- Activity severity `CRITICAL`;
- title `Maintenance failed`.

Activity detail is derived only from invocation identity and structured result. `MESSAGE`, updater stdout/stderr, `/var/log/rpi5-update.log`, command text, repository paths, tokens, and arbitrary journal messages are not Activity parser inputs.

## Agent and server routes

Agent:

```text
GET /v1/maintenance/events/recent
```

The route accepts no query selectors or request body and advertises the `maintenance.events.recent` capability. A successful journal query with no matching manager records is an available empty history. Malformed evidence, unsupported fields, oversized output, timeout, permission failure, or execution failure becomes `SOURCE_UNAVAILABLE`.

Dashboard server reads the exact agent route over the existing bounded Unix-socket client. Browser Activity still calls only:

```text
GET /api/activity
```

`/api/activity` remains selector-free and `Cache-Control: no-store`.

## Activity source semantics

Activity now has four bounded source states:

1. Docker
2. Services
3. Backup
4. Maintenance

Maintenance events use:

- source `MAINTENANCE`;
- kind `MAINTENANCE_RESULT`;
- target `/logs`;
- stable SHA-256 identity over normalized structured evidence.

One unavailable source degrades Activity but does not hide valid evidence from the other sources. Only when all four authoritative sources are unavailable does the Activity endpoint fail with `SOURCE_UNAVAILABLE`.

## Human-readable maintenance logs

Phase 5C-C also registers one ordinary Logs allowlist entry:

```text
systemd:rpi5-update -> rpi5-update.service
```

This is a fixed mapping used for follow-up human diagnostics in `/logs`. It does not broaden Activity parsing and does not permit arbitrary systemd unit selection.

## UI and responsive acceptance

The Activity page adds a Maintenance source filter and renders structured maintenance results with the existing live 5-second visible refresh. Source and severity filters remain client-side.

Regression coverage continues across the project matrix, including the Samsung Galaxy A55 authoritative portrait target (412×915), A55 landscape-equivalent sizing, narrow 320px layouts, and desktop.

## Deferred / not authorized

This phase does not:

- install, enable, start, stop, or alter `rpi5-update.service` or its timer;
- change journal ownership, ACLs, groups, or permissions;
- change the updater schedule or updater source;
- parse free-form updater messages into Activity;
- add endpoint-state Activity;
- add deploy-verification Activity;
- deploy any dashboard code to the Raspberry Pi.

Any live activation remains a separate explicit owner gate under the master roadmap.
