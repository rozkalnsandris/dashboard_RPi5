import type {
  ActivitySeverity,
  ActivitySource,
} from "@dashboard-rpi5/contracts/activity";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Archive,
  Box,
  RefreshCw,
  Rocket,
  ServerCog,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";

import { fetchActivity } from "../activity-api";

const ACTIVITY_REFRESH_MS = 5_000;
type SourceFilter = "ALL" | ActivitySource;
type SeverityFilter = "ALL" | ActivitySeverity;

function formatOccurredAt(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function sourceLabel(source: ActivitySource): string {
  switch (source) {
    case "DOCKER":
      return "Docker";
    case "SYSTEMD":
      return "Services";
    case "BACKUP":
      return "Backups";
    case "MAINTENANCE":
      return "Maintenance";
    case "DEPLOY":
      return "Deploys";
  }
}

function sourceIcon(source: ActivitySource) {
  switch (source) {
    case "DOCKER":
      return Box;
    case "SYSTEMD":
      return ServerCog;
    case "BACKUP":
      return Archive;
    case "MAINTENANCE":
      return Wrench;
    case "DEPLOY":
      return Rocket;
  }
}

export function ActivityPage() {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("ALL");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("ALL");

  const activityQuery = useQuery({
    queryKey: ["activity"],
    queryFn: ({ signal }) => fetchActivity(signal),
    staleTime: 0,
    refetchInterval: ACTIVITY_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  const filteredItems = useMemo(() => {
    const items = activityQuery.data?.items ?? [];
    return items.filter(
      (item) =>
        (sourceFilter === "ALL" || item.source === sourceFilter) &&
        (severityFilter === "ALL" || item.severity === severityFilter),
    );
  }, [activityQuery.data?.items, severityFilter, sourceFilter]);

  const unavailableSources =
    activityQuery.data?.sources.filter((source) => source.status === "UNAVAILABLE") ?? [];
  const sourceFailure = activityQuery.isError && activityQuery.data === undefined;
  const degraded = unavailableSources.length > 0;

  return (
    <section className="page-stack activity-live-page" aria-labelledby="activity-page-title">
      <div className="page-heading page-heading--compact">
        <div>
          <p className="eyebrow">What changed</p>
          <h1 id="activity-page-title">Activity</h1>
          <p>Bounded operational events from structured Docker, allowlisted service, backup, maintenance and root-authenticated deploy verification evidence. Failed deploy outcomes are never inferred from rollback-start text.</p>
        </div>
      </div>

      <div className="activity-toolbar" aria-label="Activity filters">
        <label>
          <span>Source</span>
          <select
            aria-label="Activity source"
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
          >
            <option value="ALL">All sources</option>
            <option value="DOCKER">Docker</option>
            <option value="SYSTEMD">Services</option>
            <option value="BACKUP">Backups</option>
            <option value="MAINTENANCE">Maintenance</option>
            <option value="DEPLOY">Deploys</option>
          </select>
        </label>
        <label>
          <span>Severity</span>
          <select
            aria-label="Activity severity"
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)}
          >
            <option value="ALL">All severities</option>
            <option value="INFO">Info</option>
            <option value="ATTENTION">Attention</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </label>
      </div>

      <div className="activity-status" role="status" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        <span>Live · 5s visible refresh</span>
        <span>·</span>
        <span>{filteredItems.length} visible / {activityQuery.data?.items.length ?? 0} bounded events</span>
      </div>

      {sourceFailure ? (
        <div className="logs-message logs-message--warning" role="status">
          <ShieldAlert size={18} aria-hidden="true" />
          <div><strong>Activity evidence unavailable</strong><span>Docker, service, backup, maintenance and deploy evidence sources are all unavailable.</span></div>
        </div>
      ) : null}

      {degraded ? (
        <div className="logs-message logs-message--warning" role="status">
          <ShieldAlert size={18} aria-hidden="true" />
          <div>
            <strong>Activity is degraded</strong>
            <span>Unavailable: {unavailableSources.map((source) => sourceLabel(source.source)).join(", ")}. Valid evidence from available sources remains visible.</span>
          </div>
        </div>
      ) : null}

      {activityQuery.isPending && !sourceFailure ? (
        <div className="logs-message" role="status">
          <RefreshCw size={18} aria-hidden="true" />
          <div><strong>Loading activity…</strong><span>Waiting for bounded local-agent evidence.</span></div>
        </div>
      ) : null}

      {activityQuery.data !== undefined ? (
        <section className="panel activity-page-panel" aria-label="Operational activity timeline">
          <div className="panel-heading">
            <div><p className="eyebrow">Recent evidence</p><h2>Timeline</h2></div>
            <Activity size={19} aria-hidden="true" />
          </div>

          {filteredItems.length === 0 ? (
            <p className="empty-state">No events match the selected bounded filters.</p>
          ) : (
            <ol className="activity-timeline activity-timeline--live">
              {filteredItems.map((item) => {
                const Icon = sourceIcon(item.source);
                return (
                  <li key={item.id} data-severity={item.severity}>
                    <time dateTime={item.occurredAt}>{formatOccurredAt(item.occurredAt)}</time>
                    <span className="timeline-icon" data-severity={item.severity}>
                      <Icon size={16} aria-hidden="true" />
                    </span>
                    <div className="activity-event-body">
                      <div className="timeline-title">
                        <strong>{item.title}</strong>
                        <span>{sourceLabel(item.source)}</span>
                      </div>
                      <div className="activity-event-meta">
                        <span className="activity-severity" data-severity={item.severity}>{item.severity.toLowerCase()}</span>
                        {item.groupCount > 1 ? <span>{item.groupCount} grouped events</span> : null}
                      </div>
                      <p>{item.detail}</p>
                      <a className="activity-target-link" href={item.target}>Open {sourceLabel(item.source)}</a>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ) : null}
    </section>
  );
}
