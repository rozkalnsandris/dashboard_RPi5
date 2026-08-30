# Phase 12 — Docker API version negotiation

Issue: #242

## Scope

The Docker broker must not depend on one hard-coded Engine API version when the daemon advertises a different compatible range. Version selection stays inside the privileged broker boundary and does not create a generic Docker proxy or any new write authority.

## Supported range

Dashboard source policy supports Docker Engine API versions from `1.40` through `1.55`, inclusive. The preferred version is `1.55`.

The broker discovers daemon compatibility from the fixed unversioned `GET /version` endpoint, validates `ApiVersion` and `MinAPIVersion` as canonical `major.minor` values, computes the overlap with the dashboard-owned range, and selects the highest supported version in that overlap.

Malformed metadata, an inverted daemon range, or no overlap fails closed as source unavailable. Daemon-provided version strings are never accepted as arbitrary path fragments.

## Request boundary

After negotiation, Engine requests are still constructed only from fixed internal GET route templates and already validated identifiers. The negotiated prefix changes only the `/vX.Y` component. Browser or agent callers cannot supply a Docker Engine path or API version through the broker protocol.

This applies to container reads, bounded log reads, and bounded event reads.

## Cache and invalidation

Each privileged reader caches one successful negotiated version for its lifetime. A later source/transport failure invalidates that cache for the next caller. The failing call is not automatically retried with another API version; this preserves bounded work and avoids hidden retry loops.

Container inspect/stats `404` handling keeps its existing not-found semantics rather than being treated as a version-negotiation signal.

## Tests

Source tests cover:

- preferred-version selection when the daemon supports the full dashboard range;
- selection when the daemon minimum is higher than the dashboard minimum;
- malformed and no-overlap daemon metadata;
- rejection of path-like/injection-shaped version strings;
- exact negotiated Engine request paths over an isolated Unix socket;
- negotiation for container, log, and event readers;
- cache invalidation without same-call retry.

No live Docker daemon is required by these tests.

## Runtime and deployment boundary

These repository changes alter Docker broker runtime request paths after deployment, so the eventual production-deploy classification is **YES**.

Merge does not authorize deployment. No Docker daemon, container, socket permission, systemd service, host package, network, credential, or other live RPi5 state is changed by this source lane. Separate explicit LIVE authorization remains required for production rollout or runtime mutation.
