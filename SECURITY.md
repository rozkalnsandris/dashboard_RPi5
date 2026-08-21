# Security Policy and Trust Model

## Product

`dashboard_RPi5` is an administrative observability/control interface for one Raspberry Pi 5 and will be reachable at `dash.rozkalns.net` behind Cloudflare Access.

Because the product can eventually expose logs, Docker state and a terminal, it must be treated as a **high-value administrative surface**.

## Trust boundaries

### Browser

Untrusted for secrets and host privileges. It receives normalized data only.

Phase 9J adds a source-only xterm browser surface. Xterm is only a VT renderer/input component; the browser still cannot choose executable, argv, cwd, env, uid/gid, shell or local socket path. Browser-side validation is UX hardening only and never replaces the server security boundary.

The full-terminal browser contract is:

- opening `/terminal` does not mint a session or start a PTY;
- the owner must explicitly press **Start terminal**;
- every attempt POSTs for a fresh one-time capability;
- the 64-hex capability is kept out of the URL, DOM, React state, localStorage and sessionStorage and is used only to construct the WebSocket subprotocol;
- there is no automatic reconnect or claimed-token reuse;
- xterm input is split so both the 2 KiB input-data bound and 4 KiB serialized WebSocket-frame bound hold, including JSON escaping;
- NUL input and oversized input events are rejected before send;
- only strict `ready`, bounded `output` and non-negative `exit` frames are accepted from the server;
- terminal output is rendered as ephemeral untrusted terminal data and is not persisted by dashboard history/storage/telemetry;
- route teardown aborts pending admission and closes the active WebSocket.

### Cloudflare Access + Tunnel

Authenticates the human-facing application and provides an outbound-only path from the home network. No new router port-forward is required.

### Dashboard web/API

Internet-facing application process behind Access. It must not have unrestricted host, shell or Docker privileges and must not load the native PTY module.

Phase 9I adds only a protocol-translating local terminal client to this process. It may connect to the fixed filesystem Unix socket `/run/dashboard-rpi5-terminal.sock`; the browser cannot choose a socket path or pass executable, argv, cwd, env, uid/gid or shell configuration through this bridge.

### Local RPi5 read agent

Narrow trusted helper. It owns the minimum local privileges needed for host/systemd/journal evidence and exposes only purpose-built operations over a local Unix socket.

For Docker evidence, the agent is deliberately **not** the Docker Engine authority. It has no persistent `docker` or `video` membership and communicates only with the dedicated bounded Docker broker over `/run/dashboard-rpi5-docker-broker/broker.sock`.

The privileged-read agent does **not** host the full terminal or load `node-pty`, so host-read privileges cannot be inherited by the interactive shell process.

### Dedicated Docker broker

Separate high-privilege read boundary and the sole dashboard component allowed to reach `/var/run/docker.sock`.

The broker:

- is reachable only through its fixed filesystem Unix socket;
- exposes typed bounded capabilities rather than a generic Engine proxy;
- validates container IDs, log source/range combinations and recent-event windows server-side;
- bounds request URL size, concurrency, log response size and event windows/items;
- fails closed on unknown routes or unsupported capability parameters;
- does not grant the main agent Docker socket authority;
- does not create Docker mutation capability.

Current trust path:

```text
web/API
  -> dashboard-rpi5-agent
  -> typed bounded Docker broker capabilities
  -> dashboard-rpi5-docker-broker
  -> /var/run/docker.sock
```

See [`docs/adr/0005-docker-broker-only-engine-authority.md`](docs/adr/0005-docker-broker-only-engine-authority.md).

### Local terminal agent

Separate normal-user execution boundary for the future full PTY. Its native module is isolated from both the Internet-facing web/API and the privileged-read agent.

Before any terminal transport is activated, the terminal agent must:

- run as non-root;
- have no privileged supplementary groups;
- have no Docker socket or privileged journal access;
- use a fixed server-side shell contract and fresh allowlisted environment;
- fail closed before loading native code when its runtime identity is unsafe;
- have process-tree/cgroup containment strong enough that disconnect/expiry cannot leave detached descendants running;
- expose only a narrow local Unix-socket protocol after a separate security gate.

Phase 9H defines the source-only containment shape without activating it:

- `/run/dashboard-rpi5-terminal.sock` is a filesystem Unix socket only;
- socket activation uses `Accept=yes`, so one accepted connection maps to one service instance and one systemd cgroup;
- the terminal service never receives delegated cgroup write access (`Delegate=` is forbidden);
- `ProtectControlGroups=yes` prevents the shell from managing host cgroup controls;
- `KillMode=control-group`, `SendSIGKILL=yes` and a short stop timeout make systemd/PID 1 the final process-tree cleanup authority;
- `RuntimeMaxSec=30min` independently caps a service instance even if the application lifecycle fails;
- only a dedicated `dashboard-rpi5-terminal-client` group may connect to the local socket; production membership in that group is a security-sensitive, owner-authorized decision;
- the service blocks Docker, system D-Bus and systemd private control sockets and has no network namespace access.

Phase 9I defines the source-only authenticated bridge without activating production access:

- the Phase 9A–9E owner-auth, exact-Origin and one-time session claim remain mandatory before a local connection is attempted;
- WebSocket handlers are attached before asynchronous Unix-socket connection work begins;
- browser bytes are never raw-proxied to the terminal agent;
- the server itself emits the fixed versioned `open` frame and waits for local `ready` before browser input/resize is accepted;
- browser binary frames, malformed input, NUL input, pre-ready input, unexpected local frames and protocol widening fail closed;
- local-connect time, local read size, local write buffering, WebSocket output frames and WebSocket buffered output are bounded;
- browser close/error and every bridge failure revoke the claimed session and destroy the local connection;
- terminal tokens and terminal frame contents are not logged or reflected in close reasons.

Phase 9J adds only the browser UI on top of those gates. It deliberately does not use `@xterm/addon-attach`; all xterm input/output remains inside the existing bounded Phase 9I application protocol. `FitAddon` is used only for terminal-grid sizing, and resize frames remain bounded by the server contract.

A source merge does not create the required users/groups, grant the web process connector-group membership, install these units, start the socket, enable the terminal feature gate or expose a usable production PTY.

### Docker Engine

High-privilege boundary. Control of the Docker daemon is effectively host administration. Only the dedicated bounded Docker broker may reach the Engine Unix socket for dashboard Docker evidence. The application must never expose a generic Docker API proxy, and the main agent must never regain direct Docker socket authority merely to satisfy read operations.

### Full PTY terminal

Highest-risk feature. Source implementation must remain fail-closed until the owner separately authorizes production identities, connector permissions, systemd socket/service activation and the terminal feature gate.

## Non-negotiable requirements

- Access protection before public exposure.
- HTTPS only.
- No third-party runtime JS on terminal route.
- Strict CSP.
- No secrets in client bundle.
- No tunnel tokens in repository.
- No Docker API TCP exposure for this product.
- Local helpers bind to Unix sockets or loopback only.
- Main `dashboard-rpi5-agent` has no persistent `docker` or `video` membership.
- Dedicated bounded Docker broker is the sole dashboard Docker Engine authority.
- No generic Docker Engine proxy.
- All identifiers from the browser are validated against server-side allowlists.
- Log content and terminal output are escaped/untrusted.
- WebSocket terminal handshake revalidates authenticated owner and origin.
- Terminal uses `wss` externally.
- Full terminal runs as a normal user by default, not root.
- Full terminal must not inherit privileged supplementary groups.
- No silent `sudo` or automatic privilege elevation.
- Quick Commands use fixed executable + fixed/typed argument arrays.
- Bounded timeouts, output limits and concurrency limits.
- Stale/missing evidence is shown as `UNKNOWN`, never fabricated as healthy `0`.

## Security reporting

Do not publish credentials, tokens, private hostnames, session cookies or sensitive logs in public issues. Use a private channel for credential/security incident material.
