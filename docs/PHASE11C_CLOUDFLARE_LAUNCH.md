# Phase 11C — Cloudflare Access and Tunnel launch contract

Phase 11C is source-only. It defines the reviewed production edge contract for `dash.rozkalns.net`; it does not create or modify Cloudflare resources.

## Exact edge target

```text
Internet
  -> HTTPS
  -> Cloudflare Access
  -> Cloudflare Tunnel published application
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

The dashboard origin must continue to validate the `Cf-Access-Jwt-Assertion` header using the configured Access team name, application audience and exact owner email. This origin check is mandatory even though Access is configured at the edge.

## Tunnel route contract

The future published application route must:

- use the exact reviewed Tunnel ID supplied outside GitHub;
- map only `dash.rozkalns.net` to `http://127.0.0.1:8787`;
- enable **Protect with Access** using the same Access team name and application AUD tag;
- not expose a raw agent socket, Docker socket, terminal socket or alternate dashboard port.

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
5. verify an unauthenticated request is blocked;
6. verify the origin receives and validates the Access JWT;
7. run the authenticated production smoke contract, including Samsung A55 checks.

Creating the Tunnel route before the Access protection is reviewed is not an accepted activation path.

## Rollback boundary

If edge activation fails:

- remove/disable the newly added published route before weakening Access;
- do not broaden the owner policy to recover access;
- keep origin JWT validation enabled;
- leave the previously verified local release intact;
- record the resulting production/edge state before any retry.

Any Cloudflare write, DNS change, Tunnel change, Access change or production deploy still requires separate explicit owner authorization under issue #1.
