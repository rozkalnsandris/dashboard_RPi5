# ADR-0003 — Read-only first

**Status:** Accepted  
**Date:** 2026-08-15

## Decision

Initial production capability is observability only. Logs follow after metrics; Quick Commands follow logs; full PTY follows a dedicated security review; host/Docker mutation follows only after another owner gate.

## Rationale

A dashboard can deliver most daily value without immediately turning a public web application into a remote root/Docker control surface.
