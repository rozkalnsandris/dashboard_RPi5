# Issue #215 — terminal WebSocket heartbeat hardening

Status: source-only reliability correction. Production deployment is separate.

## Evidence

The nullable `ws.send()` callback defect was corrected by PR #221. Production
acceptance subsequently produced two explained lifecycle sequences:

```text
SESSION_1=READY_THEN_WS_CLOSE_1006_UNEXPECTED
SESSION_2=READY_THEN_WS_CLOSE_1000_OWNER_DISCONNECT
SECOND_ACCEPT_EXPLAINED=YES
FRONTEND_AUTO_RECONNECT=NO
```

The unexpected first close had no bridge `FAIL`, no service restart and no local
terminal protocol failure. Current source also intentionally records a peer-side
`1006` close as `WS_CLOSE` without manufacturing a server failure.

Cloudflare WebSocket guidance states that idle WebSocket connections can be closed
and recommends heartbeat traffic for long-lived connections. The `ws` project
likewise documents ping/pong as the server-side mechanism for detecting broken
connections.

## Change

The terminal WebSocket route attaches a transport-only heartbeat before attaching
the terminal bridge:

- server protocol `ping` every 25 seconds;
- browser/WebSocket-stack protocol `pong` is expected within 10 seconds;
- missing pong terminates the WebSocket fail-closed;
- ping failure terminates fail-closed;
- close/error cancels heartbeat timers.

No heartbeat payload is added to the dashboard terminal application protocol.

## Security invariant

Heartbeat traffic must not count as terminal activity.

The heartbeat module does not call `TerminalSessionRegistry.touchClaimedTransport`,
does not create terminal `input` or `resize`, and does not write to the local Unix
terminal transport. The local terminal agent therefore continues to enforce its
existing 5-minute idle timeout and 30-minute absolute session lifetime from actual
terminal activity only.

This change does not widen:

- Cloudflare Access owner authentication;
- exact Origin enforcement;
- one-time session capability handling;
- WebSocket payload limits or subprotocol selection;
- PTY/process privileges;
- systemd identities, groups or permissions;
- Docker/journal/sudo/root authority;
- Cloudflare configuration.

## Acceptance

Source validation must prove:

1. heartbeat ping is emitted on the bounded interval;
2. pong keeps the WebSocket transport alive;
3. missing pong terminates the transport;
4. browser close cancels heartbeat timers;
5. ping failure terminates fail-closed;
6. existing terminal bridge/protocol/security tests remain green;
7. production deployment is not implied by merge.
