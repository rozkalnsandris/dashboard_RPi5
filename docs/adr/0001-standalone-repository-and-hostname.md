# ADR-0001 — Standalone repository and hostname

**Status:** Accepted  
**Date:** 2026-08-15

## Decision

Build the Raspberry Pi dashboard as a standalone repository named `dashboard_RPi5` and expose the eventual application at `dash.rozkalns.net`.

## Rationale

The product has a distinct deployment/runtime/security boundary from the existing decision-control application. Keeping it standalone makes Docker/host/terminal permissions reviewable without broadening another product's trust boundary.
