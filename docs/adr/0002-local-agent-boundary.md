# ADR-0002 — Web process separated from privileged local agent

**Status:** Accepted  
**Date:** 2026-08-15

## Decision

The Internet-facing dashboard web/API process will not directly own unrestricted host/Docker privileges. A local agent provides a narrow purpose-built interface over a Unix socket.

## Consequences

- slightly more local architecture;
- much clearer privilege boundary;
- easier allowlist testing;
- terminal/Docker access can be added independently;
- agent is never directly exposed to the Internet.
