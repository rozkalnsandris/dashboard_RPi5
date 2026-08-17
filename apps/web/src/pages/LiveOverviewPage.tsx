import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ChevronRight,
  Cpu,
  HardDrive,
  MemoryStick,
  ServerCog,
  ShieldCheck,
  Thermometer,
} from "lucide-react";
import { Link } from "react-router";

import { fetchActivity } from "../activity-api";
import { fetchCurrentDocker, fetchCurrentHost } from "../current-state-api";
import {
  containerNeedsAttention,
  formatBytes,
  formatUptime,
  throttleSummary,
} from "../current-state-ui";
import { CurrentDockerView } from "../components/CurrentDockerView";

const REFRESH_MS = 10_000;
const STALE_AFTER_MS = 30_000;

function observedTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function LiveOverviewPage() {
  const hostQuery = useQuery({
    queryKey: ["current-host"],
    queryFn: ({ signal }) => fetchCurrentHost(signal),
    staleTime: 5_000,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  const dockerQuery = useQuery({
    queryKey: ["current-docker"],
    queryFn: ({ signal }) => fetchCurrentDocker(signal),
    staleTime: 5_000,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  const activityQuery = useQuery({
    queryKey: ["activity"],
    queryFn: ({ signal }) => fetchActivity(signal),
    staleTime: 5_000,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  const host = hostQuery.data;
  const docker = dockerQuery.data;
  const throttle = host === undefined ? null : throttleSummary(host);
  const now = Date.now();
  const hostStale = host !== undefined && now - Date.parse(host.observedAt) > STALE_AFTER_MS;
  const dockerStale = docker !== undefined && now - Date.parse(docker.observedAt) > STALE_AFTER_MS;

  const attention: string[] = [];
  if (host === undefined && hostQuery.isError) attention.push("Host current-state evidence unavailable");
  if (docker === undefined && dockerQuery.isError) attention.push("Docker current-state evidence unavailable");
  if (hostStale || hostQuery.isRefetchError) attention.push("Host evidence is stale or refresh failed");
  if (dockerStale || dockerQuery.isRefetchError) attention.push("Docker evidence is stale or refresh failed");
  if (throttle?.active) attention.push(`Power flags active: ${throttle.detail}`);
  if (docker !== undefined) {
    const affected = docker.containers.filter(containerNeedsAttention).length;
    if (affected > 0) attention.push(`${affected} container${affected === 1 ? "" : "s"} need attention`);
  }

  const metricCards = [
    {
      label: "CPU temp",
      value: host === undefined ? "Unavailable" : `${host.temperature.celsius.toFixed(0)}°C`,
      detail: host === undefined ? "No trustworthy evidence" : "Live sensor",
      icon: Thermometer,
    },
    {
      label: "Throttle",
      value: throttle?.label ?? "Unavailable",
      detail: throttle?.detail ?? "No trustworthy evidence",
      icon: ShieldCheck,
    },
    {
      label: "CPU",
      value: host === undefined ? "Unavailable" : `${host.cpu.usagePercent.toFixed(0)}%`,
      detail: host === undefined
        ? "No trustworthy evidence"
        : `load ${host.loadAverage.oneMinute.toFixed(2)} / ${host.loadAverage.fiveMinutes.toFixed(2)} / ${host.loadAverage.fifteenMinutes.toFixed(2)}`,
      icon: Cpu,
    },
    {
      label: "RAM",
      value: host === undefined ? "Unavailable" : formatBytes(host.memory.usedBytes),
      detail: host === undefined ? "No trustworthy evidence" : `of ${formatBytes(host.memory.totalBytes)} · ${host.memory.usedPercent.toFixed(0)}%`,
      icon: MemoryStick,
    },
    {
      label: "NVMe",
      value: host === undefined ? "Unavailable" : `${host.filesystem.usedPercent.toFixed(0)}%`,
      detail: host === undefined ? "No trustworthy evidence" : `${formatBytes(host.filesystem.usedBytes)} of ${formatBytes(host.filesystem.totalBytes)}`,
      icon: HardDrive,
    },
    {
      label: "Uptime",
      value: host === undefined ? "Unavailable" : formatUptime(host.uptimeSeconds),
      detail: host === undefined ? "No trustworthy evidence" : "Host online",
      icon: ServerCog,
    },
  ];

  const recentActivity = activityQuery.data?.items.slice(0, 3) ?? [];

  return (
    <div className="page-stack">
      <section className="overview-hero" aria-labelledby="overview-title">
        <div>
          <p className="eyebrow">Private operations cockpit</p>
          <h1 id="overview-title">Raspberry Pi 5</h1>
          <p>Live read-only evidence from the local RPi5 agent. Missing evidence is shown as unavailable, never replaced with fixture values.</p>
        </div>
        <div className="hero-status" aria-label="System summary">
          <span className="count-pill">Live · read-only</span>
          <span>{host === undefined ? "Host evidence unavailable" : `Observed ${observedTime(host.observedAt)}`}</span>
        </div>
      </section>

      <section className="attention-card" aria-labelledby="attention-title">
        <div className="attention-card__icon"><ShieldCheck size={20} aria-hidden="true" /></div>
        <div>
          <h2 id="attention-title">Needs attention</h2>
          <p>{attention.length === 0 ? "No current host or Docker attention signals in the latest trustworthy snapshots." : attention.join(" · ")}</p>
        </div>
        {attention.length === 0 ? <span className="health-pill">All clear</span> : <span className="count-pill">{attention.length} signal{attention.length === 1 ? "" : "s"}</span>}
      </section>

      <section className="metric-grid" aria-label="System metrics">
        {metricCards.map(({ label, value, detail, icon: Icon }) => (
          <article className="metric-card" key={label}>
            <div className="metric-card__topline"><span>{label}</span><Icon size={18} aria-hidden="true" /></div>
            <strong>{value}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </section>

      <div className="overview-grid">
        <section className="panel panel--docker" aria-labelledby="docker-title">
          <div className="panel-heading">
            <div><p className="eyebrow">Runtime · live</p><h2 id="docker-title">Docker</h2></div>
            <span className="count-pill">
              {docker === undefined ? "Unknown" : `${docker.containers.filter((container) => container.state === "RUNNING").length}/${docker.containers.length}`}
            </span>
          </div>
          {docker === undefined ? (
            <p>Docker evidence unavailable. No fixture container values are substituted.</p>
          ) : (
            <CurrentDockerView containers={docker.containers} limit={3} />
          )}
          <Link className="panel-link" to="/docker">View all containers <ChevronRight size={16} aria-hidden="true" /></Link>
        </section>

        <section className="panel" aria-labelledby="activity-title">
          <div className="panel-heading">
            <div><p className="eyebrow">What changed · live</p><h2 id="activity-title">Recent activity</h2></div>
            <Activity size={19} aria-hidden="true" />
          </div>
          {recentActivity.length === 0 ? (
            <p>{activityQuery.isError ? "Activity evidence unavailable. No fixture events are substituted." : "No recent normalized activity events."}</p>
          ) : (
            <ol className="activity-list">
              {recentActivity.map((item) => (
                <li key={item.id}>
                  <time>{observedTime(item.occurredAt)}</time>
                  <span className={`activity-dot${item.severity === "INFO" ? " activity-dot--good" : " activity-dot--warning"}`} aria-hidden="true" />
                  <span>{item.title}</span>
                </li>
              ))}
            </ol>
          )}
          <Link className="panel-link" to="/activity">Open activity <ChevronRight size={16} aria-hidden="true" /></Link>
        </section>
      </div>
    </div>
  );
}
