# Production launch source boundary

This directory is source-only. Nothing here authorizes host, systemd, Cloudflare, user/group, socket-permission or deployment mutation.

Canonical files:

- `launch-contract.json` — machine-readable identities, paths and capability defaults;
- `web.env.example` — base production environment with terminal disabled;
- `terminal.env.example` — future owner-gated terminal activation inputs; intentionally incomplete/fail-closed.

Read-only candidate validation:

```text
npm run preflight:production -- --release /opt/dashboard_RPi5/releases/<sha> --sha <sha>
```

The preflight reads only. Any production activation still requires a separate explicit owner authorization under issue #1.
