# Phase 8B — Quick Commands activation gate

Phase 8A added a bounded read-only Quick Command implementation. Phase 8B makes the runtime trust boundary explicit so a normal future dashboard deploy cannot activate that capability by accident.

## Default state

Quick Commands are **disabled by default**.

The agent reads:

```text
DASHBOARD_RPI5_QUICK_COMMANDS
```

Only the exact value:

```text
enabled
```

registers `/v1/quick-commands` and `/v1/quick-commands/run`.

Missing, empty, malformed or alternate truthy values (`1`, `true`, `yes`, case variants or whitespace variants) remain disabled.

## Canonical systemd blueprint

`ops/systemd/dashboard-rpi5-agent.service` explicitly sets:

```text
Environment=DASHBOARD_RPI5_QUICK_COMMANDS=disabled
```

The blueprint itself is source-only and must not be installed, enabled, restarted or otherwise activated without separate owner authorization under issue #1.

A future normal deployment using the canonical blueprint therefore leaves Quick Commands unavailable. Enabling them requires a separate, explicit owner-authorized production configuration change.

## Browser/server behavior while disabled

The browser and server Quick Command surfaces may exist in source, but the agent does not register the privileged-read routes. Calls through the server therefore fail closed as unavailable rather than falling back to a shell, alternate executable, or generic proxy.

## Security invariants preserved

- no browser-provided executable or argv;
- no generic shell;
- no PTY;
- no sudo/root escalation;
- no Docker control;
- no systemctl write verbs;
- no package/deploy/backup mutation;
- no host permission expansion;
- no Cloudflare change;
- no production activation in this phase.

## Activation procedure boundary

Source merge is not activation.

A live enable action must be separately authorized by the owner and must fresh-check the intended production SHA, exact configuration change, agent service state and rollback path before setting the live value to `enabled` and restarting/reloading anything production-impacting.

**Production deploy: NO.**
