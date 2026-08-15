import {
  Activity,
  Box,
  Boxes,
  ChevronRight,
  CircleEllipsis,
  Cpu,
  DatabaseBackup,
  HardDrive,
  LayoutDashboard,
  MemoryStick,
  ScrollText,
  ServerCog,
  Settings,
  ShieldCheck,
  TerminalSquare,
  Thermometer,
} from "lucide-react";
import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from "react-aria-components";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useRouteError,
} from "react-router";

import { activityFixture, containerFixtures, systemFixture } from "./fixtures";

const primaryNavigation = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/docker", label: "Docker", icon: Boxes },
  { to: "/services", label: "Services", icon: ServerCog },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/terminal", label: "Terminal", icon: TerminalSquare },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/backups", label: "Backups", icon: DatabaseBackup },
  { to: "/deployments", label: "Deployments", icon: ShieldCheck },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const mobilePrimaryPaths = new Set(["/", "/docker", "/logs", "/terminal"]);
const mobilePrimary = primaryNavigation.filter(({ to }) => mobilePrimaryPaths.has(to));
const mobileMore = primaryNavigation.filter(({ to }) => !mobilePrimaryPaths.has(to));

function HealthPill() {
  return (
    <span className="health-pill health-pill--good">
      <span className="status-dot" aria-hidden="true" />
      Healthy
    </span>
  );
}

function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark" aria-hidden="true">R5</div>
      <div>
        <strong>dashboard_RPi5</strong>
        <span>dash.rozkalns.net</span>
      </div>
    </div>
  );
}

function MobileMoreMenu() {
  return (
    <MenuTrigger>
      <Button className="mobile-nav__item mobile-nav__more" aria-label="More destinations">
        <CircleEllipsis size={20} aria-hidden="true" />
        <span>More</span>
      </Button>
      <Popover className="mobile-more-popover" placement="top end">
        <Menu className="mobile-more-menu" aria-label="More dashboard destinations">
          {mobileMore.map(({ to, label, icon: Icon }) => (
            <MenuItem key={to} id={to} className="mobile-more-menu__item" textValue={label}>
              <Link to={to}>
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

export function AppShell() {
  const location = useLocation();
  const activeLabel = primaryNavigation.find(({ to }) =>
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to),
  )?.label ?? "Overview";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>

      <aside className="desktop-sidebar">
        <Brand />
        <nav className="desktop-nav" aria-label="Dashboard navigation">
          {primaryNavigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) => `desktop-nav__link${isActive ? " is-active" : ""}`}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <HealthPill />
          <span>Phase 1 · fixture mode</span>
        </div>
      </aside>

      <header className="workspace-header">
        <div className="mobile-brand"><Brand /></div>
        <div className="workspace-heading">
          <span className="workspace-kicker">RPi5</span>
          <strong>{activeLabel}</strong>
        </div>
        <HealthPill />
      </header>

      <main id="main-content" className="main-content">
        <Outlet />
      </main>

      <nav className="mobile-nav" aria-label="Primary navigation">
        {mobilePrimary.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) => `mobile-nav__item${isActive ? " is-active" : ""}`}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
        <MobileMoreMenu />
      </nav>
    </div>
  );
}

const metricCards = [
  { label: "CPU temp", value: `${systemFixture.temperatureC}°C`, detail: "Good", icon: Thermometer },
  { label: "Throttle", value: systemFixture.throttle, detail: "No power flags", icon: ShieldCheck },
  { label: "CPU", value: `${systemFixture.cpuPercent}%`, detail: "load 0.42 / 0.37 / 0.31", icon: Cpu },
  {
    label: "RAM",
    value: `${systemFixture.memoryUsedGiB.toFixed(1)} GB`,
    detail: `of ${systemFixture.memoryTotalGiB} GB`,
    icon: MemoryStick,
  },
  { label: "NVMe", value: `${systemFixture.diskPercent}%`, detail: "Root filesystem", icon: HardDrive },
  { label: "Uptime", value: systemFixture.uptime, detail: "Host online", icon: ServerCog },
] as const;

export function OverviewPage() {
  return (
    <div className="page-stack">
      <section className="overview-hero" aria-labelledby="overview-title">
        <div>
          <p className="eyebrow">Private operations cockpit</p>
          <h1 id="overview-title">Raspberry Pi 5</h1>
          <p>Fixture UI only. No live RPi, Docker, systemd, terminal or Cloudflare control is connected.</p>
        </div>
        <div className="hero-status" aria-label="System summary">
          <HealthPill />
          <span>Observed {new Date(systemFixture.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </section>

      <section className="attention-card" aria-labelledby="attention-title">
        <div className="attention-card__icon"><ShieldCheck size={20} aria-hidden="true" /></div>
        <div>
          <h2 id="attention-title">Needs attention</h2>
          <p>No active incidents in fixture state.</p>
        </div>
        <span className="health-pill health-pill--good">All clear</span>
      </section>

      <section className="metric-grid" aria-label="System metrics">
        {metricCards.map(({ label, value, detail, icon: Icon }) => (
          <article className="metric-card" key={label}>
            <div className="metric-card__topline">
              <span>{label}</span>
              <Icon size={18} aria-hidden="true" />
            </div>
            <strong>{value}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </section>

      <div className="overview-grid">
        <section className="panel panel--docker" aria-labelledby="docker-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Runtime</p>
              <h2 id="docker-title">Docker</h2>
            </div>
            <span className="count-pill">{systemFixture.runningContainers}/{systemFixture.expectedContainers}</span>
          </div>
          <div className="desktop-table-wrap">
            <table className="docker-table">
              <thead>
                <tr><th>Container</th><th>Health</th><th>CPU</th><th>RAM</th><th>Network</th><th>Uptime</th></tr>
              </thead>
              <tbody>
                {containerFixtures.map((container) => (
                  <tr key={container.id}>
                    <td><span className="container-name"><Box size={15} aria-hidden="true" />{container.name}</span></td>
                    <td><span className="inline-status"><span className="status-dot" />Healthy</span></td>
                    <td>{container.cpuPercent}%</td>
                    <td>{container.memoryMiB} MB</td>
                    <td>↓{container.networkRxMiB} ↑{container.networkTxMiB} MB</td>
                    <td>{container.uptime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mobile-container-list">
            {containerFixtures.map((container) => (
              <article className="container-row" key={container.id}>
                <header><strong>{container.name}</strong><span className="inline-status"><span className="status-dot" />Healthy</span></header>
                <dl>
                  <div><dt>CPU</dt><dd>{container.cpuPercent}%</dd></div>
                  <div><dt>RAM</dt><dd>{container.memoryMiB} MB</dd></div>
                  <div><dt>Network</dt><dd>↓{container.networkRxMiB} ↑{container.networkTxMiB}</dd></div>
                  <div><dt>Uptime</dt><dd>{container.uptime}</dd></div>
                </dl>
              </article>
            ))}
          </div>
          <Link className="panel-link" to="/docker">View all containers <ChevronRight size={16} aria-hidden="true" /></Link>
        </section>

        <section className="panel" aria-labelledby="activity-title">
          <div className="panel-heading">
            <div><p className="eyebrow">What changed</p><h2 id="activity-title">Recent activity</h2></div>
            <Activity size={19} aria-hidden="true" />
          </div>
          <ol className="activity-list">
            {activityFixture.map((item) => (
              <li key={`${item.time}-${item.label}`}>
                <time>{item.time}</time>
                <span className={`activity-dot activity-dot--${item.tone}`} aria-hidden="true" />
                <span>{item.label}</span>
              </li>
            ))}
          </ol>
          <Link className="panel-link" to="/activity">Open activity <ChevronRight size={16} aria-hidden="true" /></Link>
        </section>
      </div>
    </div>
  );
}

export function DockerPage() {
  return (
    <section className="page-stack" aria-labelledby="docker-page-title">
      <div className="page-heading"><p className="eyebrow">Fixture runtime view</p><h1 id="docker-page-title">Docker containers</h1><p>Desktop uses a semantic table. Compact phone layouts use dedicated readable rows.</p></div>
      <div className="panel">
        {containerFixtures.map((container) => (
          <article className="container-row container-row--wide" key={container.id}>
            <header><strong>{container.name}</strong><span className="inline-status"><span className="status-dot" />Healthy</span></header>
            <dl>
              <div><dt>CPU</dt><dd>{container.cpuPercent}%</dd></div>
              <div><dt>RAM</dt><dd>{container.memoryMiB} MB</dd></div>
              <div><dt>RX / TX</dt><dd>{container.networkRxMiB} / {container.networkTxMiB} MB</dd></div>
              <div><dt>Uptime</dt><dd>{container.uptime}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

const pageCopy: Record<string, { title: string; description: string }> = {
  "/services": { title: "Services", description: "Allowlisted systemd service state will live here in a later read-only phase." },
  "/logs": { title: "Logs", description: "Unified Docker/journal log exploration shell. No log source is connected yet." },
  "/terminal": { title: "Terminal", description: "Quick Commands first; full owner PTY remains explicitly disabled in Phase 1." },
  "/activity": { title: "Activity", description: "Docker, service, backup, endpoint and deployment changes will converge here." },
  "/backups": { title: "Backups", description: "Freshness, result, duration, size and retention evidence will be shown here." },
  "/deployments": { title: "Deployments", description: "GitHub main versus proven production SHA will be visible without implicit deployment." },
  "/settings": { title: "Settings", description: "Presentation and safe dashboard preferences. No production trust changes from this page." },
};

export function PlaceholderPage() {
  const { pathname } = useLocation();
  const copy = pageCopy[pathname] ?? { title: "Dashboard", description: "This route is reserved for a later Phase 1 slice." };

  return (
    <section className="placeholder-page" aria-labelledby="placeholder-title">
      <p className="eyebrow">Phase 1 fixture route</p>
      <h1 id="placeholder-title">{copy.title}</h1>
      <p>{copy.description}</p>
      <div className="placeholder-terminal" aria-label="Disabled fixture terminal">
        <span>$</span>
        <code>live capability disabled</code>
      </div>
    </section>
  );
}

export function RouteErrorPage() {
  const error = useRouteError();
  return (
    <main className="route-error">
      <p className="eyebrow">Navigation error</p>
      <h1>That dashboard view could not be opened.</h1>
      <p>{error instanceof Error ? error.message : "Unknown route error"}</p>
      <Link to="/">Return to Overview</Link>
    </main>
  );
}
