# dashboard_RPi5

Modern Raspberry Pi 5 homelab operations dashboard for **`https://dash.rozkalns.net`**.

> **Mutable state is not stored in this README.** For current source/PR/CI/continuation state read [issue #213 — canonical handoff](https://github.com/rozkalnsandris/dashboard_RPi5/issues/213) and refresh GitHub. For actual production/runtime state require fresh trusted-host evidence. A repository SHA or merged source change is not proof of what is currently running on the RPi5.
>
> **Canonical durable product/security contract:** [issue #1 — MASTER / READ FIRST](https://github.com/rozkalnsandris/dashboard_RPi5/issues/1)

## Goal

`dashboard_RPi5` is the daily operations cockpit for the Raspberry Pi 5. It should answer, in seconds:

1. Is the Pi healthy?
2. What is using resources or behaving abnormally?
3. What changed recently?
4. Where are the relevant logs/evidence?
5. What is the safest next diagnostic action?

The dashboard is **not** a Prometheus replacement, general Grafana clone, full Portainer replacement or generic root control panel. Prometheus remains the metrics/history authority; Grafana may remain a specialist/deep-analysis tool. The dashboard brings high-value operational evidence into one deliberate interface.

## Frontend direction

The durable frontend baseline is **HTML-first React**:

```text
React + TypeScript + Vite
  -> semantic HTML first
  -> browser-native controls/primitives first
  -> plain product CSS + CSS custom properties
  -> CSS cascade layers
  -> extra UI libraries only when behavior/accessibility justifies them
```

React Router and TanStack Query remain for routing and live/remote state. React Aria is reserved for justified complex accessible widgets. Tailwind/shadcn are no longer architectural defaults; existing Tailwind source wiring is removed only through a separate usage/Preflight + visual/accessibility regression change.

See:

- [`docs/adr/0007-html-first-react-plain-css-baseline.md`](docs/adr/0007-html-first-react-plain-css-baseline.md)
- [`docs/TECH_STACK.md`](docs/TECH_STACK.md)
- [`docs/HTML_CSS_MOBILE_IMPLEMENTATION.md`](docs/HTML_CSS_MOBILE_IMPLEMENTATION.md)

## Samsung Galaxy A55 first-class mobile target

The Galaxy A55 5G is the physical mobile acceptance device. Implementation is responsive, not device-sniffed:

- works from 320 CSS px upward;
- compact-phone design tuned around 360–430 CSS px;
- Samsung Browser + Chrome;
- browser + installed PWA;
- portrait + landscape;
- keyboard-safe Logs/Terminal;
- 48px normal touch targets;
- zoom remains enabled;
- safe-area insets come from the browser.

See [`docs/MOBILE_SAMSUNG_A55.md`](docs/MOBILE_SAMSUNG_A55.md).

## Architecture

```text
Browser / phone
    |
    | HTTPS + Cloudflare Access
    v
Cloudflare Tunnel
    |
    v
Dashboard web/API on RPi5 loopback
    |-- bounded Prometheus reads
    |-- specialist Grafana drill-down
    |
    | Unix socket / narrow local protocol
    v
RPi5 main agent
    |-- bounded Docker broker Unix socket
    |       `-- Docker Engine Unix socket
    |-- systemd / journal
    |-- vcgencmd / sysfs / procfs
    `-- allowlisted evidence/actions

Separate terminal path:
Browser -> terminal admission/WS -> contained terminal-agent -> normal-user PTY
```

The web process does not get arbitrary root access or an unrestricted Docker API proxy. The dedicated Docker broker remains the sole Docker Engine authority. Terminal authority remains separately contained and owner-gated.

## Security baseline

- browser is untrusted for host privileges/secrets;
- no generic Docker Engine proxy;
- no arbitrary shell command API;
- fixed/typed allowlists at trust boundaries;
- bounded timeout/output/concurrency;
- missing/stale evidence is never presented as healthy;
- full PTY and all write capabilities remain separately gated;
- merge authorization is not deployment authorization;
- any live RPi5/systemd/Docker/Cloudflare/credential/permission/data mutation requires the exact owner authorization defined by repository policy.

## GitHub workflow

```text
issue -> fresh main -> branch -> focused change -> Draft PR
      -> exact-head CI/manual review -> Ready -> STOP
      -> explicit owner squash merge -> exact-main verify
      -> Production deploy: YES/NO
```

See [`AGENTS.md`](AGENTS.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Key documents

- [`AGENTS.md`](AGENTS.md) — mandatory worker/assistant rules.
- [`SECURITY.md`](SECURITY.md) — trust boundaries.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — repository roadmap index.
- [`docs/TECH_STACK.md`](docs/TECH_STACK.md) — current durable implementation stack.
- [`docs/adr/0007-html-first-react-plain-css-baseline.md`](docs/adr/0007-html-first-react-plain-css-baseline.md) — frontend architecture baseline.
- [`docs/MOBILE_SAMSUNG_A55.md`](docs/MOBILE_SAMSUNG_A55.md) — mobile acceptance contract.
- [`docs/HTML_CSS_MOBILE_IMPLEMENTATION.md`](docs/HTML_CSS_MOBILE_IMPLEMENTATION.md) — canonical HTML/CSS implementation guidance.
- [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md) — data-source authority.
- [`docs/TERMINAL_AND_LOGS_SECURITY.md`](docs/TERMINAL_AND_LOGS_SECURITY.md) — terminal/log boundary.
- [`docs/adr/`](docs/adr/) — durable architecture decisions.

## Development principle

```text
observe -> explain -> drill down -> act only through an explicit trusted gate
```
