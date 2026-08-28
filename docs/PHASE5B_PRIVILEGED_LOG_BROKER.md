# Phase 5B extension — bounded privileged log broker

Issue #223 extends the existing unified Logs page without turning the dashboard into a generic journal or filesystem browser.

## User-facing result

After a separately authorized live activation, the source picker may advertise the following fixed groups:

- **Docker:** Home Assistant, Prometheus;
- **Systemd:** Docker Engine, SSH, Cron scheduler, Dashboard agent, RPi5 maintenance, Cloudflared, RPi5 monitor, RPi5 post-reboot, RPi5 tmp headroom, RPi5 dashboard evidence, Hermes Tech web;
- **Journal:** RPi5 deploy;
- **Files:** RPi5 backup.

The UI uses native `optgroup` grouping. Search, range presets, live/pause, wrap, copy, newest, output caps and plain-text rendering retain the Phase 5B behavior.

## Trust boundary

Docker logs remain on the existing dedicated Docker broker. The main `dashboard-rpi5-agent` does not regain Docker Engine authority.

Journal and root-owned file evidence use a second local helper:

```text
browser
  -> web/API
  -> dashboard-rpi5-agent
  -> /run/dashboard-rpi5-log-broker/broker.sock
  -> fixed journal/file registrations only
```

The log broker accepts only `GET` requests for a compiled allowlist of `sourceId` plus one of `15m|1h|6h|24h`. It does not accept a file path, systemd unit, journal match, executable, shell fragment or generic command from the caller. Unknown routes, methods, malformed output, timeouts, oversize responses and concurrency exhaustion fail closed.

The current `/var/log/rpi5-backup.log` remains root-owned `0600`. The broker blueprint therefore uses a separate root process instead of weakening that file or granting broad journal/root authority to the main agent. Its systemd sandbox keeps the host filesystem read-only, hides home directories, removes capabilities and network address families, and exposes only the fixed Unix socket to the dedicated client group. This is a deliberate privileged-read boundary and requires explicit owner review before activation.

## Bounds

The existing parsing contract remains authoritative:

- maximum 400 normalized entries;
- maximum 8,192 characters per message;
- maximum 512 KiB source input;
- maximum 256 KiB registered-file tail;
- 1.5 s journal command timeout;
- no shell invocation.

The broker additionally limits its request URL, response bytes, concurrent requests and outer operation deadline. Responses are `no-store` JSON and are revalidated against the shared log contract by the main-agent client.

## Production advertisement gate

Source merge or ordinary dashboard deployment does **not** make privileged sources selectable. `DASHBOARD_RPI5_PRIVILEGED_LOGS` is fail-closed unless its exact value is `enabled`.

The default production behavior therefore remains the existing two Docker sources until all of the following are separately owner-authorized and reconciled together:

1. create the dedicated `dashboard-rpi5-log-client` connector group if absent;
2. install the reviewed log-broker service unit;
3. apply the reviewed main-agent connector/feature-gate drop-in;
4. enable/start the log broker and restart the affected agent only inside the approved live envelope;
5. verify every advertised source from the dashboard and verify unknown source IDs remain unavailable.

No Cloudflare change is required.

## Activation gate

This document and its systemd files are source-only blueprints. Merge authorization is not activation authorization. Production deployment, creation of the connector group, systemd installation/enabling/restart and enabling the privileged-log feature gate remain a separate explicit owner-authorized live mutation.
