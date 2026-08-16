# Security Policy and Trust Model

## Product

`dashboard_RPi5` is an administrative observability/control interface for one Raspberry Pi 5 and will be reachable at `dash.rozkalns.net` behind Cloudflare Access.

Because the product can eventually expose logs, Docker state and a terminal, it must be treated as a **high-value administrative surface**.

## Trust boundaries

### Browser

Untrusted for secrets and host privileges. It receives normalized data only.

### Cloudflare Access + Tunnel

Authenticates the human-facing application and provides an outbound-only path from the home network. No new router port-forward is required.

### Dashboard web/API

Internet-facing application process behind Access. It must not have unrestricted host, shell or Docker privileges and must not load the native PTY module.

### Local RPi5 read agent

Narrow trusted helper. It owns the minimum local privileges needed to read host/Docker/systemd evidence. It is reachable only locally, preferably through a Unix socket.

The privileged-read agent does **not** host the full terminal or load `node-pty`, so future Docker/journal/host-read privileges cannot be inherited by the interactive shell process.

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

### Docker Engine

High-privilege boundary. Control of the Docker daemon is effectively host administration. The application must never expose a generic Docker API proxy.

### Full PTY terminal

Highest-risk feature. It is implemented only after read-only monitoring and log flows are stable and reviewed.

## Non-negotiable requirements

- Access protection before public exposure.
- HTTPS only.
- No third-party runtime JS on terminal route.
- Strict CSP.
- No secrets in client bundle.
- No tunnel tokens in repository.
- No Docker API TCP exposure for this product.
- Local helpers bind to Unix sockets or loopback only.
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
