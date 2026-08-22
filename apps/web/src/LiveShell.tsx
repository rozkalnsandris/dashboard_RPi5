import {
  Activity,
  Boxes,
  CircleEllipsis,
  DatabaseBackup,
  LayoutDashboard,
  ScrollText,
  ServerCog,
  ShieldCheck,
  TerminalSquare,
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
  useNavigate,
  useRouteError,
} from "react-router";

const primaryNavigation = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/docker", label: "Docker", icon: Boxes },
  { to: "/services", label: "Services", icon: ServerCog },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/terminal", label: "Terminal", icon: TerminalSquare },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/backups", label: "Backups", icon: DatabaseBackup },
  { to: "/deployments", label: "Deployments", icon: ShieldCheck },
] as const;

const mobilePrimaryPaths = new Set(["/", "/docker", "/logs", "/terminal"]);
const mobilePrimary = primaryNavigation.filter(({ to }) => mobilePrimaryPaths.has(to));
const mobileMore = primaryNavigation.filter(({ to }) => !mobilePrimaryPaths.has(to));

function ModePill() {
  return <span className="count-pill">Live · read-only</span>;
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
  const navigate = useNavigate();
  return (
    <MenuTrigger>
      <Button className="mobile-nav__item mobile-nav__more" aria-label="More destinations">
        <CircleEllipsis size={20} aria-hidden="true" />
        <span>More</span>
      </Button>
      <Popover className="mobile-more-popover" placement="top end">
        <Menu
          className="mobile-more-menu"
          aria-label="More dashboard destinations"
          onAction={(key) => navigate(String(key))}
        >
          {mobileMore.map(({ to, label, icon: Icon }) => (
            <MenuItem key={to} id={to} className="mobile-more-menu__item" textValue={label}>
              <span className="mobile-more-menu__content">
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </span>
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

export function LiveAppShell() {
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
          <ModePill />
          <span>Production evidence · no write controls</span>
        </div>
      </aside>

      <header className="workspace-header">
        <div className="mobile-brand"><Brand /></div>
        <div className="workspace-heading">
          <span className="workspace-kicker">RPi5</span>
          <strong>{activeLabel}</strong>
        </div>
        <ModePill />
      </header>

      <main id="main-content" className="main-content"><Outlet /></main>

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
