# CONTRIBUTING.md

## Read first

Before changing this repository, read:

1. [`AGENTS.md`](AGENTS.md)
2. [Master issue #1](https://github.com/rozkalnsandris/dashboard_RPi5/issues/1)
3. [`SECURITY.md`](SECURITY.md)
4. [`docs/ROADMAP.md`](docs/ROADMAP.md)

## Workflow

```text
issue -> fresh main -> fresh branch -> focused change -> Draft PR
      -> exact-head CI -> manual diff review -> Ready -> STOP
      -> explicit owner squash merge -> exact-main verification
      -> Production deploy: YES/NO
```

Do not merge without explicit owner authorization.

Do not combine unrelated trust-boundary changes.

## Branch names

Examples:

```text
feat/phase1-app-shell
feat/a55-mobile-navigation
feat/read-only-host-agent
fix/log-stream-backpressure
docs/update-terminal-security
```

## Pull requests

Every PR must state:

- what changed;
- what did not change;
- trust-boundary impact;
- validation;
- exact production/deploy impact;
- whether separate owner authorization is required.

Prefer Draft PR first.

## Security-sensitive changes

Changes involving any of these need their own focused review:

- Docker socket/API;
- systemd/root permissions;
- Cloudflare Access/Tunnel/secrets;
- logs;
- shell/commands;
- WebSockets;
- PTY/xterm.js;
- production deploy controllers;
- backup mutation;
- PWA cache behavior for authenticated data.

## Documentation

Architecture/security behavior and documentation must change together.

If code violates issue #1, issue #1 must be explicitly amended first rather than silently drifting.
