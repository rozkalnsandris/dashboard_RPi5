# Phase 12 terminal WebSocket output bound

Issue #240 hardens the existing full-terminal WebSocket bridge without changing terminal authority, activation, authentication, session admission or protocol capabilities.

## Bound

Before the server queues any serialized `ready`, `output` or `exit` application frame, it computes the exact UTF-8 payload byte length and requires:

```text
bufferedAmount + nextFrameBytes <= 64 KiB
```

The implementation uses the overflow-safe equivalent `bufferedAmount <= MAX - nextFrameBytes`. A projected value exactly at the bound is accepted; any value above it fails closed with the existing `TERMINAL_OUTPUT_BACKPRESSURE` / WebSocket close-class behavior.

`bufferedAmount` must itself be a non-negative safe integer. `NaN`, infinities, negative values and fractional values fail closed rather than weakening the queue bound.

The `ws` `bufferedAmount` value represents queued application-data bytes, so this application-level queue contract is expressed in the exact serialized UTF-8 payload bytes reported by that accounting surface. It does not invent a constant transport-framing allowance that `bufferedAmount` does not expose.

The existing per-frame maximum remains separate and unchanged. There is no dynamic queue growth, retry loop or backpressure buffering mechanism.

## Security and activation boundary

This is source-only resource-bound hardening. It does not enable the terminal, alter Cloudflare, systemd, users/groups/permissions, Docker authority, Quick Commands, production configuration or any live runtime state. A future source merge is classified `Production deploy: YES` because server terminal-gateway behavior changes, but merge does not authorize deployment or terminal activation.