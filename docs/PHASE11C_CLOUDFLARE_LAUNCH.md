# Phase 11C — Cloudflare Access and Tunnel launch contract

Phase 11C is source-only. It defines the reviewed production edge contract for `dash.rozkalns.net`; it does not create or modify Cloudflare resources.

## Exact edge target

```text
Internet
  -> HTTPS
  -> Cloudflare Access
  -> Cloudflare Tunnel / cloudflared Protect with Access
  -> http://127.0.0.1:8787
  -> dashboard web/API
```

No router port-forward is part of this design.

The loopback origin must remain consistent with `ops/production/launch-contract.json`. Any hostname, protocol, address or port drift blocks activation review.

## Access application contract

The future Access application must:

- be a self-hosted application for the entire `dash.rozkalns.net` hostname;
- remain deny-by-default;
- contain one owner Allow policy using the exact Email selector;
- obtain the owner email from the out-of-repo `DASHBOARD_OWNER_EMAIL` activation binding;
- not use an email-domain wildcard as a substitute for the exact owner;
- not add a Bypass policy;
- not treat service-token-only authentication as the human owner path.

## Base dashboard JWT enforcement point

For the base dashboard, the mandatory Access JWT validation point is **`cloudflared` Protect with Access before origin proxy**, not a second global Fastify middleware.

Cloudflare documents that when Protect with Access is enabled for a Tunnel public hostname, `cloudflared` validates the `Cf-Access-Jwt-Assertion` JWT before proxying an L7 request to the origin. The reviewed v2 contract therefore binds that gate to the exact Access team name and application AUD and requires it before `http://127.0.0.1:8787` can receive public traffic.

This is not an authentication downgrade. Public traffic must still pass both the Access application policy and the Tunnel Protect with Access JWT gate. The dashboard server remains loopback-only, so there is no accepted public network path that bypasses `cloudflared`.

The base Fastify application is **not required to register a global Access-JWT middleware**. This keeps local loopback health checks deterministic and avoids duplicating the same base-app JWT gate at two adjacent layers.

## Terminal defense in depth remains separate

`apps/server/src/cloudflare-access-owner-auth.ts` remains the independent application-layer cryptographic verifier for the future full terminal. It validates the Access assertion signature, issuer, application audience and exact owner identity before terminal session admission when the terminal is separately enabled.

The terminal verifier is intentionally stronger than the base-app boundary because the terminal is the highest-risk capability. This Phase 11C alignment does not remove, weaken or activate that verifier, and it does not enable the terminal.

## Tunnel route contract

The future published application route must:

- use the exact reviewed Tunnel ID supplied outside GitHub;
- map only `dash.rozkalns.net` to `http://127.0.0.1:8787`;
- enable **Protect with Access**;
- configure Protect with Access with the exact `DASHBOARD_CLOUDFLARE_TEAM_NAME` and `DASHBOARD_CLOUDFLARE_APPLICATION_AUDIENCE` values;
- require `cloudflared` to validate `Cf-Access-Jwt-Assertion` before proxying to the loopback origin;
- not expose a raw agent socket, Docker socket, terminal socket or alternate dashboard port.

The machine-readable contract is `dashboard-rpi5.cloudflare-launch.v2`. The v2 bump makes the enforcement point explicit and prevents the former v1 wording from being interpreted as an unwired application-global Fastify check.

## Required out-of-repo activation bindings

The repository intentionally contains no real production values for these bindings:

```text
DASHBOARD_CLOUDFLARE_TEAM_NAME
DASHBOARD_CLOUDFLARE_APPLICATION_AUDIENCE
DASHBOARD_OWNER_EMAIL
DASHBOARD_CLOUDFLARE_TUNNEL_ID
```

No Cloudflare API token is required by the Phase 11C source verifier and no token belongs in the repository.

The read-only verifier can validate a separately prepared activation env file without contacting Cloudflare:

```text
npm run preflight:cloudflare -- \
  --contract ops/production/cloudflare-contract.json \
  --launch ops/production/launch-contract.json \
  --env /path/outside/repo/dashboard-cloudflare.env
```

Without `--env`, it validates only the reviewed repository contracts.

## Owner-authorized future order

The activation order is deliberately fail-closed:

1. create the Access self-hosted application;
2. create the exact-owner Email Allow policy;
3. verify the Access configuration is deny-by-default and contains no bypass;
4. only then publish the Tunnel route to `http://127.0.0.1:8787` with Protect with Access enabled;
5. verify the configured Tunnel gate validates the Access JWT before origin proxy;
6. verify an unauthenticated public request is blocked before dashboard origin content;
7. run the authenticated production smoke contract, including Samsung A55 checks.

Creating the Tunnel route before the Access protection is reviewed is not an accepted activation path.

## Local versus public smoke

Local loopback smoke and public Access smoke test different boundaries:

- `http://127.0.0.1:8787/api/health` is an allowed local host check after the service is started; it intentionally does not traverse Cloudflare Access or the Tunnel;
- `https://dash.rozkalns.net/` is the public path and must never reach dashboard origin content without Access authorization and the `cloudflared` JWT gate;
- an authenticated public smoke proves the full edge path after Access/Tunnel activation;
- Quick Commands and terminal remain disabled during the base production smoke.

## Rollback boundary

If edge activation fails:

- remove/disable the newly added published route before weakening Access;
- do not broaden the owner policy to recover access;
- keep Protect with Access enabled while the route exists;
- leave the previously verified local release intact;
- record the resulting production/edge state before any retry.

Any Cloudflare write, DNS change, Tunnel change, Access change or production deploy still requires separate explicit owner authorization under issue #1.
