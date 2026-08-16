# Phase 9F — bounded terminal application protocol and PTY lifecycle contract

Status: source-only implementation for issue #59. No native PTY adapter and no production activation.

## Why Phase 9F does not add `node-pty`

The current `node-pty` project documents an important security property: processes launched through it run at the same permission level as the parent process. That makes native PTY creation a separate execution trust boundary for an Internet-reachable server.

As reviewed on 2026-08-16:

- npm `latest` for `node-pty` is 1.1.0;
- the active 1.2 release line is still beta;
- the package is a native addon;
- this repository CI intentionally installs dependencies with `npm ci --ignore-scripts`.

Changing that CI/install policy merely to make a native PTY package work would expand the supply-chain and runtime boundary at the same time as introducing shell execution. Phase 9F deliberately avoids combining those changes.

Phase 9G must perform a dedicated Linux/RPi5 dependency and runtime review before choosing a native adapter/version or changing install-script policy.

## Protocol scope

The existing Phase 9D/9E WebSocket subprotocol remains:

```text
dashboard-rpi5-terminal-v1
```

Phase 9F defines the application messages that may travel after a future native PTY has been attached.

### Client -> server

Only two JSON message shapes are valid.

Input:

```json
{"type":"input","data":"pwd\r"}
```

Rules:

- exact keys only: `type`, `data`;
- `data` must be a non-empty string;
- UTF-8 payload data is limited to 2048 bytes;
- no separate command or paste message exists.

Resize:

```json
{"type":"resize","cols":100,"rows":30}
```

Rules:

- exact keys only: `type`, `cols`, `rows`;
- both values must be integers;
- columns: 2..300;
- rows: 2..200.

Rejected:

- binary frames;
- malformed JSON;
- arrays;
- unknown message types;
- unknown/extra fields;
- empty or oversized input;
- fractional or out-of-range dimensions.

A protocol violation terminates the PTY lifecycle rather than trying to recover from ambiguous browser input.

## Server -> client

Ready:

```json
{"type":"ready"}
```

Output:

```json
{"type":"output","data":"..."}
```

A single PTY adapter output callback is limited to 64 KiB of UTF-8 data. Anything larger fails closed before chunk allocation. Accepted output is then split on Unicode code-point boundaries into chunks whose raw UTF-8 data is at most 8192 bytes before JSON framing.

Exit:

```json
{"type":"exit","exitCode":0}
```

or, when present:

```json
{"type":"exit","exitCode":2,"signal":15}
```

Invalid negative/non-integer adapter exit metadata is normalized to zero before serialization.

## Output backpressure

The future socket adapter exposes only `bufferedAmount`, `send` and `close` to the lifecycle controller.

Before every output chunk is sent, `bufferedAmount` is checked against a fixed 64 KiB threshold. At or above the threshold the lifecycle fails closed:

- kill PTY;
- revoke terminal session;
- close with code 1013 and fixed reason `TERMINAL_OUTPUT_OVERLOAD`.

The same fixed overload closure is used when one PTY output callback exceeds the 64 KiB per-event limit.

The controller does not buffer an additional transcript in application memory.

## PTY adapter contract

Phase 9F introduces **interfaces only**:

```text
TerminalPtyFactory.create({ cols, rows })
TerminalPtyProcess.write(data)
TerminalPtyProcess.resize(cols, rows)
TerminalPtyProcess.kill()
TerminalPtyProcess.onData(...)
TerminalPtyProcess.onExit(...)
```

Notably absent from the interface:

- executable/command;
- shell path;
- arguments;
- cwd;
- environment variables;
- uid/gid;
- sudo/root selection;
- browser-provided process configuration.

Therefore a future browser message cannot choose what process is spawned. The Phase 9G Linux adapter must hard-code or server-side derive its normal-user shell contract independently of browser data.

## Lifecycle policy

`attachTerminalPtyLifecycle()` requires an already-live **claimed** transport session token and an injected PTY factory. A minted but unclaimed token cannot construct a PTY.

On attach:

1. verify/touch the claimed session;
2. create exactly one PTY using fixed initial size 80x24;
3. attach PTY data/exit listeners;
4. send `ready`;
5. start idle and absolute-lifetime timers.

Client `input` and valid `resize` count as activity. PTY output does **not** count as user activity, so a noisy or runaway process cannot keep its own session alive.

Existing security limits remain authoritative:

- idle timeout: 5 minutes;
- absolute maximum lifetime: 30 minutes;
- session concurrency: 1.

The absolute timer is calculated from the original registry creation metadata and is never extended by later input.

These conditions terminate idempotently, revoke the session, and kill the PTY:

- disconnect;
- malformed/binary client frame;
- idle timeout;
- absolute max lifetime;
- registry session expiry;
- PTY write/resize failure;
- transport send failure;
- oversized PTY output event;
- output backpressure overload.

A normal PTY exit does not call `kill()` again; it emits an exit frame, revokes the session and closes cleanly.

## What is deliberately not wired yet

Phase 9F does not replace the inert Phase 9E WebSocket message handler. The new lifecycle is tested directly with a fake PTY adapter only.

This means merging 9F cannot create a shell accidentally. A real route-to-PTY binding requires the later native-adapter phase and its own review.

## Phase 9G gate

Before a native PTY adapter may be merged, Phase 9G must at minimum decide and test:

- exact `node-pty` or alternative version;
- Node.js 24 + Debian 12 + RPi5 arm64 compatibility;
- native build/prebuild behavior;
- whether CI/install scripts must change and the resulting supply-chain implications;
- server runtime UID/GID and an explicit refusal to run the terminal adapter as root;
- fixed server-side shell path and fixed argv;
- safe bounded environment allowlist;
- fixed working directory;
- no automatic sudo;
- process-group/child cleanup behavior;
- native PTY termination on disconnect/idle/max-lifetime;
- source-only tests plus a controlled Linux integration test where feasible.

Production activation remains a separate owner gate after all source phases.

## Production state

Phase 9F changes TypeScript source/tests/docs only. It does not add a native dependency, spawn a process, modify CI install-script policy, change Cloudflare, mutate the host, or activate terminal production configuration.

**Production deploy: NO.**
