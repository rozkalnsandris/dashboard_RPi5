# Samsung Galaxy A55 Mobile UI Contract

> **Reference device:** Samsung Galaxy A55 5G  
> **Product:** `dashboard_RPi5`  
> **Hostname:** `dash.rozkalns.net`  
> **Status:** first-class mobile acceptance target

## 1. Why the A55 is a first-class target

Samsung specifies the Galaxy A55 5G with a **6.6-inch Super AMOLED display**, **1080 × 2340 FHD+** resolution, and a **maximum 120 Hz refresh rate**.

Those are hardware pixels, not CSS layout pixels. The web application must **not** build a `1080px`-wide phone layout or detect the phone model. Modern browsers map high-density hardware pixels to CSS pixels, and the effective CSS viewport also changes with browser chrome, page zoom, Android display/font scaling, orientation, and installed-PWA mode.

Therefore the acceptance rule is:

> **A55 is the real-device reference; responsive CSS is the implementation mechanism.**

The UI must remain correct from **320 CSS px upward**, with the primary compact-phone design optimized for roughly **360–430 CSS px** portrait widths and verified on the physical A55.

---

# 2. Browser targets

Mandatory real-device checks:

1. Samsung Browser on the Galaxy A55;
2. Chrome on Android on the Galaxy A55;
3. normal browser tab mode;
4. installed standalone PWA mode;
5. portrait;
6. landscape.

Do **not** use Samsung model/user-agent sniffing for layout. Samsung Browser now reduces parts of the mobile UA, and users can also request desktop content. Layout must be driven by viewport/container/input capabilities instead.

---

# 3. HTML viewport contract

Use this baseline in `index.html`:

```html
<meta
  name="viewport"
  content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
/>
```

Rules:

- `width=device-width` is mandatory;
- `initial-scale=1` is mandatory;
- **never** use `user-scalable=no`;
- **never** cap `maximum-scale` to prevent zoom;
- `viewport-fit=cover` allows the app shell to use the full display while CSS safe-area variables protect important UI;
- `interactive-widget=resizes-content` is preferred for the dashboard because search/filter/terminal inputs must stay usable when the Android keyboard appears;
- the layout must still remain usable in browsers that ignore the `interactive-widget` hint.

---

# 4. Safe-area contract

The A55 has a modern edge-to-edge display shape. Do not guess notch/corner/status/navigation-bar sizes.

Use browser-provided environment values:

```css
:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
}
```

Application shell:

```css
.app-shell {
  min-height: 100svh;
  padding-inline:
    max(12px, var(--safe-left))
    max(12px, var(--safe-right));
}
```

Bottom navigation:

```css
.mobile-nav {
  position: sticky;
  bottom: 0;
  padding:
    8px
    max(10px, var(--safe-right))
    calc(8px + var(--safe-bottom))
    max(10px, var(--safe-left));
}
```

Do not hardcode a Samsung status-bar or navigation-bar height.

---

# 5. `svh` vs `dvh`

Use viewport-height units deliberately.

## Normal dashboard pages

Prefer a stable shell:

```css
.app-shell {
  min-height: 100svh;
}
```

This avoids making the entire dashboard repeatedly resize just because mobile browser chrome retracts/expands while scrolling.

## Terminal / log viewer

The terminal and full-height log viewer may intentionally track the current visible viewport:

```css
.terminal-page,
.live-log-page {
  height: 100dvh;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}
```

`dvh` can resize when browser UI changes, so it should not be sprayed across every card/component.

---

# 6. Mobile navigation

The A55 portrait layout uses a **bottom primary navigation**, not a permanent desktop sidebar.

Recommended primary tabs:

```text
Overview | Docker | Logs | Terminal | More
```

`More` contains:

```text
Services
Activity
Backups
Deployments
Settings
```

Why:

- core destinations remain close to the thumb;
- no desktop sidebar steals horizontal space;
- five destinations are still large enough for comfortable touch targets;
- secondary tools do not crowd the primary path.

Example HTML:

```html
<nav class="mobile-nav" aria-label="Primary">
  <a href="/" aria-current="page">Overview</a>
  <a href="/docker">Docker</a>
  <a href="/logs">Logs</a>
  <a href="/terminal">Terminal</a>
  <button type="button" aria-haspopup="menu">More</button>
</nav>
```

---

# 7. Touch-target contract

WCAG 2.2 AA requires at least 24 × 24 CSS px targets or sufficient spacing, but this product uses a stronger phone baseline.

For the A55:

```css
:root {
  --touch-min: 48px;
  --touch-primary: 52px;
}

button,
.touch-target,
.mobile-nav > * {
  min-height: var(--touch-min);
}

.primary-action {
  min-height: var(--touch-primary);
}
```

Rules:

- icon-only buttons: at least `44–48px` hit box;
- important actions: `52px` high where practical;
- 8px or more between adjacent destructive/confirm actions;
- never make the icon itself the only 18–20px tappable area;
- do not require drag-only gestures.

---

# 8. Mobile typography

Use readable density rather than tiny desktop-dashboard text.

```css
:root {
  --font-body: clamp(0.94rem, 0.9rem + 0.2vw, 1rem);
  --font-label: 0.78rem;
  --font-value: clamp(1.35rem, 1.1rem + 1vw, 1.8rem);
}

body {
  font-size: var(--font-body);
  line-height: 1.45;
}

input,
select,
textarea,
button {
  font: inherit;
}

input,
select,
textarea {
  font-size: 1rem;
}
```

Rules:

- body approximately 15–16 CSS px;
- form/search/terminal command controls 16 CSS px;
- labels around 12–13 CSS px but never critical information only in tiny labels;
- metrics use tabular numerals;
- allow Android/Samsung font scaling to reflow rather than clipping.

```css
.metric-value,
.table-number {
  font-variant-numeric: tabular-nums;
}
```

---

# 9. A55 Overview layout

Portrait first screen should prioritize:

```text
┌────────────────────────────────┐
│ dashboard_RPi5      ● Healthy │
│ dash.rozkalns.net              │
├────────────────────────────────┤
│ Needs attention                │
│ No active incidents            │
├───────────────┬────────────────┤
│ CPU temp      │ Throttle       │
│ 43°C · Good   │ None           │
├───────────────┼────────────────┤
│ CPU           │ RAM            │
│ 12%           │ 3.0 / 8 GB     │
├───────────────┼────────────────┤
│ NVMe          │ Uptime         │
│ 41%           │ 37d 14h        │
├────────────────────────────────┤
│ Docker                    16/16│
│ homeassistant    6.8%   624 MB │
│ prometheus       3.2%   418 MB │
│ grafana          1.7%   286 MB │
│ View all →                     │
├────────────────────────────────┤
│ Recent activity                │
│ 02:12 container restarted      │
│ 02:00 backup completed         │
└────────────────────────────────┘
│ Overview Docker Logs Term More │
└────────────────────────────────┘
```

### Grid implementation

```css
.mobile-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

@media (max-width: 340px) {
  .mobile-metrics {
    grid-template-columns: 1fr;
  }
}
```

Do not assume that because the physical A55 has 1080 horizontal pixels the dashboard can fit six desktop metrics in a row.

---

# 10. Docker mobile layout

Do not force the desktop seven-column table into portrait.

Use a compact accessible row/card:

```text
homeassistant                 ● Healthy
CPU 6.8%    RAM 624 MB / 8 GB
NET ↓74 MB  ↑18 MB   Uptime 12d
                         Details →
```

Suggested HTML:

```html
<article class="container-row">
  <header>
    <h3>homeassistant</h3>
    <span class="status">Healthy</span>
  </header>

  <dl class="container-row__stats">
    <div><dt>CPU</dt><dd>6.8%</dd></div>
    <div><dt>RAM</dt><dd>624 MB</dd></div>
    <div><dt>Network</dt><dd>74 MB / 18 MB</dd></div>
    <div><dt>Uptime</dt><dd>12d 4h</dd></div>
  </dl>

  <a href="/docker/homeassistant">Details</a>
</article>
```

Desktop remains a semantic `<table>`. Mobile and desktop may render the same normalized data through different presentational components.

---

# 11. Logs on the A55

The phone log page needs a different information density than desktop.

## Mobile toolbar

Use two rows at most:

```text
[Source ▼] [Live ●] [Pause]
[Search logs................]
```

Advanced filters move into a bottom sheet/dialog.

## Log viewport

```css
.log-viewer {
  overflow: auto;
  overscroll-behavior: contain;
  font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
  font-size: 0.78rem;
  line-height: 1.5;
  -webkit-overflow-scrolling: touch;
}
```

Requirements:

- line wrap toggle;
- follow/pause toggle;
- if the user scrolls away from the bottom, **stop forced auto-scroll**;
- show `42 new lines` button instead;
- timestamp can collapse to `HH:mm:ss` on phone;
- source/severity can become badges;
- cap/virtualize rendered lines;
- selection/copy must work normally.

Do not use a giant fixed filter header that leaves only a few lines of logs visible.

---

# 12. Terminal on the A55

The full terminal is possible, but the phone-first workflow is **Quick Commands**.

## Terminal page order

```text
Recent / favorite Quick Commands
--------------------------------
System info
Docker stats
Disk usage
Temperature + throttle
Backup status
Service status
--------------------------------
Open full terminal
```

## Full PTY mobile shell

When the PTY phase exists:

- terminal occupies the flexible remaining viewport;
- top bar is compact;
- bottom navigation is hidden while the live PTY is open, or reduced to an explicit Exit/Disconnect bar;
- keyboard appearance must not cover the terminal prompt;
- terminal controls (Ctrl, Esc, Tab, arrows) may be provided in a horizontally scrollable accessory row;
- accessory buttons need 44–48px touch boxes;
- never block pinch/page zoom globally with `touch-action: none`.

Example layout:

```css
.terminal-shell {
  height: 100dvh;
  min-height: 0;
  display: grid;
  grid-template-rows:
    auto
    minmax(0, 1fr)
    auto;
  padding-top: var(--safe-top);
  padding-bottom: var(--safe-bottom);
}
```

---

# 13. Touch and hover CSS

A Galaxy phone has touch as the primary interaction. Do not make important information appear only on hover.

```css
.action:hover {
  /* no required behavior here */
}

@media (hover: hover) and (pointer: fine) {
  .action:hover {
    background: var(--surface-hover);
  }
}
```

Do not globally set:

```css
* {
  touch-action: none;
}
```

Only constrain touch gestures on a component that truly implements a custom pointer gesture, and preserve normal page panning/pinch zoom.

---

# 14. Charts on the A55

Overview:

- no more than one compact sparkline inside a metric card;
- no more than 2 detailed charts visible in one phone screen;
- actual numeric value is always visible without touching the chart.

Detail pages:

- 1h / 24h / 7d segmented control;
- single-column charts;
- minimum chart height around 180–220 CSS px;
- touch tooltip must not require pixel-perfect targeting;
- landscape may show wider detail but cannot be required.

Avoid high-frequency animated redraws. The A55 supports 120 Hz, but a monitoring page gains nothing from repainting charts at 120 fps.

---

# 15. Polling / battery / thermal budget

A 120 Hz display does not mean telemetry should update 120 times per second.

Mobile defaults:

| Data | Visible page | Background/hidden |
|---|---:|---:|
| host summary | 10s | 60s / pause |
| Docker live stats | 10s | 60s / pause |
| endpoint health | 30s | 2–5 min |
| backup/update | 60s+ | pause/slow |
| detailed history | on view, then 30–60s | pause |
| logs | explicit stream | stop when page hidden |
| terminal | interactive only | disconnect/timeout policy |

Use `document.visibilityState` to pause/slow nonessential refreshes when the dashboard is backgrounded.

---

# 16. PWA mode on Samsung

`dashboard_RPi5` should be installable as a PWA so it behaves like a dedicated admin app from the A55 home screen.

PWA baseline:

```json
{
  "id": "/",
  "name": "dashboard_RPi5",
  "short_name": "RPi5",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#070b11",
  "theme_color": "#070b11"
}
```

Include at least appropriate 192×192 and 512×512 icons, plus a maskable icon when artwork exists.

## Service-worker safety

Cache only static application-shell assets by default.

Never persistently cache through the service worker:

- terminal I/O;
- log responses;
- authentication/session responses;
- sensitive API output;
- secrets/tokens;
- one-time action results.

The PWA may continue to open its shell offline, but privileged/live operational state must clearly display **Offline / Stale / Unknown**.

---

# 17. Reflow and accessibility

The dashboard must remain functional at 320 CSS px width, consistent with WCAG 2.2 reflow requirements.

At narrow widths:

- never clip critical state;
- do not require two-dimensional page scrolling;
- a real data table can have its own horizontal overflow when its two-dimensional structure is genuinely necessary;
- prefer the dedicated mobile Docker row view rather than depending on table overflow for the primary workflow;
- long SHA/container/image values truncate visually but remain available on detail/copy.

---

# 18. Samsung Browser / Chrome keyboard acceptance

Test search, log filtering and full terminal with the on-screen keyboard open.

Acceptance:

- focused input stays visible;
- submit/clear controls stay reachable;
- bottom navigation does not sit on top of the keyboard;
- terminal prompt/output remains visible;
- opening/closing keyboard does not strand the page at an invalid scroll offset;
- rotating while keyboard is closed does not destroy state.

The layout must not depend only on `window.innerHeight` measured once at startup.

---

# 19. Orientation

Do **not** lock the PWA to portrait.

Portrait is the primary dashboard view.

Landscape is useful for:

- terminal;
- logs;
- detailed graphs;
- wide container metadata.

Responsive layout should naturally adapt rather than maintain a separate “A55 landscape app”.

---

# 20. Real-device acceptance matrix

Before calling the mobile UI complete, verify on the physical A55:

## Browser modes

- [ ] Samsung Browser normal tab
- [ ] Chrome normal tab
- [ ] Samsung/Chrome installed PWA where available

## Layout

- [ ] portrait
- [ ] landscape
- [ ] browser toolbar visible
- [ ] browser toolbar retracted
- [ ] Android navigation mode used by owner
- [ ] increased system font size
- [ ] increased display scaling if configured
- [ ] browser page zoom above default where supported

## Core flows

- [ ] Overview readable without horizontal page scroll
- [ ] Needs Attention appears before secondary widgets
- [ ] Docker rows tappable one-handed
- [ ] Docker detail opens/closes without losing scroll position
- [ ] Logs search/filter works with keyboard
- [ ] Live logs can pause without forced scrolling
- [ ] Quick Commands fit without tiny buttons
- [ ] full terminal (later) remains visible with keyboard
- [ ] Access login/re-auth returns to intended route
- [ ] offline/disconnected state is explicit

## Accessibility

- [ ] pinch/page zoom not disabled
- [ ] 320 CSS px reflow test passes
- [ ] controls have large touch hit areas
- [ ] status is not color-only
- [ ] focus is not hidden behind sticky header/nav
- [ ] reduced motion respected

---

# 21. Automated viewport matrix

Use automated browser tests as regression protection, but do not treat them as a replacement for the physical A55.

Minimum CSS viewport matrix:

```text
320 × 700   extreme narrow/reflow gate
360 × 800   compact Android
384 × 854   common Android class
393 × 873   compact modern phone class
412 × 915   primary A55-class emulation target
430 × 932   wide phone
800 × 360   compact landscape
915 × 412   A55-class landscape
```

The **412 × 915** target is a practical test viewport, not a claim that every A55 browser/user setting always reports exactly those CSS dimensions.

---

# 22. Definition of done for A55 optimization

Mobile UI is done when:

1. the real A55 is the acceptance device, not merely an emulator;
2. Samsung Browser and Chrome both work;
3. browser and PWA modes work;
4. Overview requires no horizontal scrolling;
5. touch targets are comfortable, not merely technically compliant;
6. keyboard does not break logs/terminal/search;
7. physical-pixel resolution is never used as a layout breakpoint;
8. safe areas are browser-derived, not guessed;
9. PWA does not cache sensitive operational data;
10. the same code remains responsive on other phones and desktop/DeX.
