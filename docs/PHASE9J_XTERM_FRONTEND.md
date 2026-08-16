# Phase 9J — xterm frontend and Samsung A55 terminal UX

## Baseline

- source baseline: `16bd8e42e9101bf37893d4eba77d999f2086c42a`
- exact-main CI #225 / run `31944116756`: SUCCESS
- predecessor: Phase 9I authenticated WebSocket -> local Unix terminal bridge
- issue: #67

## Stable frontend dependencies

Phase 9J pins the stable npm releases:

- `@xterm/xterm` `6.0.0`
- `@xterm/addon-fit` `0.11.0`

The one-shot lockfile workflow existed only to let npm generate the exact lockfile and removed itself in the same generated-lock commit. The normal repository policy remains `npm ci --ignore-scripts`.

`@xterm/addon-attach` is intentionally not used. The dashboard already has a purpose-built authenticated WebSocket protocol with owner admission, exact Origin, one-time token claim, bounded JSON messages and a local Phase 9I translator. Raw xterm WebSocket attachment would bypass that application-level contract.

## Browser session lifecycle

Opening `/terminal` does **not** create a PTY.

The owner must press **Start terminal**. Only then does the browser:

1. POST the exact empty JSON object to `/api/terminal/session`;
2. strictly validate the returned 64-hex token and fixed 5-minute/30-minute lifetime contract;
3. create a WebSocket to the fixed same-origin `/api/terminal/ws` URL;
4. place the token only in the one-time `session.<token>` WebSocket subprotocol alongside `dashboard-rpi5-terminal-v1`;
5. wait for the server `ready` frame before enabling xterm stdin;
6. translate xterm `onData` only into bounded `{type:"input",data}` frames;
7. translate fitted xterm dimensions only into bounded `{type:"resize",cols,rows}` frames.

There is no automatic reconnect. A new attempt always POSTs for a fresh capability. The token is not put in the URL, DOM, React state, localStorage or sessionStorage.

## Browser protocol bounds

Phase 9J independently revalidates the browser edge:

- one xterm input event is capped at 16 KiB before splitting;
- each translated input data chunk is at most 2 KiB UTF-8;
- each complete serialized WebSocket frame is at most 4 KiB, including JSON escaping overhead;
- NUL input is rejected client-side to match the Phase 9F/9I server contract;
- resize is limited to 2..300 columns and 2..200 rows;
- only strict `ready`, bounded `output` and non-negative `exit` server frames are accepted;
- malformed/binary/unexpected data ends the browser connection fail-closed;
- raw WebSocket close reasons and native/local error text are never rendered.

The server remains authoritative. Browser checks improve UX and reduce accidental invalid traffic; they are not treated as a security boundary against a malicious client.

## Xterm rendering and privacy

Xterm is used only as a VT renderer/input surface. It does not receive executable, argv, cwd, env, uid/gid, socket path or shell configuration.

The dashboard does not persist terminal output to app state, history APIs, local/session storage or telemetry. The currently rendered xterm buffer exists only in page memory and is disposed when the route unmounts or a new session replaces it.

## Samsung Galaxy A55 acceptance

The existing Playwright project `a55-class` (`412x915`) remains the primary mobile target.

Phase 9J requires:

- no horizontal page overflow;
- Start / Open keyboard / Disconnect controls at least 48 px high;
- a terminal viewport at least 280 px high in normal portrait mode;
- explicit **Open keyboard** action focusing xterm's helper textarea;
- the helper textarea uses a 16 px font to avoid Android Chrome focus zoom;
- `ResizeObserver`, window resize and `visualViewport.resize` all coalesce through one animation-frame fit path;
- `FitAddon.fit()` remains the canonical character-grid measurement;
- a simulated reduced viewport height (mobile browser chrome/software keyboard class of change) causes a fresh bounded resize frame;
- compact landscape may reduce the viewport to 220 px while preserving scrollable page access to controls.

## Production boundary

Phase 9J is source-only.

It does **not**:

- enable `DASHBOARD_TERMINAL_ENABLED`;
- create or change production users/groups;
- grant the web service terminal connector-group membership;
- install/enable/start the terminal systemd socket/service;
- activate `/run/dashboard-rpi5-terminal.sock`;
- change Cloudflare Access, Tunnel or DNS;
- deploy production.

**Production deploy: NO.**
