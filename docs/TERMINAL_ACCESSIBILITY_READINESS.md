# Terminal accessibility readiness

Issue: #194

This document defines the source-level accessibility gate for the Phase 9 full terminal. It does **not** authorize or imply production PTY activation.

## Current source contract

The terminal UI keeps the existing bounded Phase 9 security model and adds an explicit browser-local screen-reader preference:

- xterm.js minimum contrast ratio remains `4.5`;
- screen-reader support is opt-in and can be changed before or during a session;
- the preference is stored only as the bounded value `enabled` or `disabled` in browser local storage;
- storage failure is non-fatal and falls back to standard xterm mode;
- changing the accessibility preference does not create, restart or broaden a terminal session;
- the terminal input focus action remains keyboard/touch reachable with a 48px control;
- the terminal viewport is labelled and references the accessibility-mode description;
- session tokens remain memory-only and terminal output remains non-persistent.

xterm.js exposes `screenReaderMode` as a mutable public option. The preference is intentionally explicit rather than forced globally because assistive-technology behavior varies across browser/screen-reader combinations.

## Source acceptance

A source change is Ready only when all of the following are true:

1. focused web tests cover exact preference parsing, bounded persistence, storage failure and live option application;
2. typecheck/build and the repository-selected exact-head CI surface pass;
3. the 320 CSS px and Samsung A55-class layout keep all terminal controls reachable without horizontal overflow;
4. Start terminal, Open keyboard, Screen reader and Disconnect controls retain visible focus and at least 48px touch targets;
5. the screen-reader toggle exposes pressed state and descriptive text without persisting session material;
6. terminal production activation remains unchanged and fail-closed.

## Manual acceptance before any future live activation

Before Phase 9 production activation is requested, perform a bounded accessibility/device acceptance on the exact candidate:

- keyboard-only navigation through all terminal controls;
- Samsung A55 portrait and landscape, including the software keyboard open;
- browser zoom and increased font/display scaling;
- screen-reader mode off and on;
- at least one supported screen-reader/browser pairing available to the owner;
- verify that disconnect/session expiry remains reachable and understandable;
- verify no session token appears in URL or browser storage and no terminal output is retained by the dashboard.

A screen-reader-specific upstream xterm behavior discovered during that acceptance is a blocker for activation, not permission to weaken the terminal security boundary.

## Production boundary

After this source work is merged:

```text
TERMINAL_SOURCE_ACCESSIBILITY_READY=YES
TERMINAL_PRODUCTION_ACTIVE=NO
SYSTEMD_TERMINAL_SOCKET_ACTIVE=NO
TERMINAL_PERMISSION_EXPANSION=NO
CLOUDFLARE_MUTATION=NO
```

Any future terminal activation must use one separately owner-authorized Composite Live envelope bound to the exact Git SHA, target host, required systemd/socket/group/config mutations, explicit exclusions, pre-mutation baseline and final reconciliation. Merge alone never authorizes that activation.
