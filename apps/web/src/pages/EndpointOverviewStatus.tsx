import { useQuery } from "@tanstack/react-query";
import { Activity, CircleCheck, Globe2, ShieldAlert } from "lucide-react";
import { Link } from "react-router";

import { fetchPublicEndpointStatus } from "../endpoints-api";

const ENDPOINT_REFRESH_MS = 30_000;

function formatDetail(statusCode: number | null, latencyMs: number | null): string {
  const parts: string[] = [];
  if (statusCode !== null) parts.push(`HTTP ${statusCode}`);
  if (latencyMs !== null) parts.push(`${latencyMs} ms`);
  return parts.length === 0 ? "No probe detail in evidence" : parts.join(" · ");
}

export function EndpointOverviewStatus() {
  const endpointQuery = useQuery({
    queryKey: ["public-endpoint-status"],
    queryFn: ({ signal }) => fetchPublicEndpointStatus(signal),
    staleTime: 0,
    refetchInterval: ENDPOINT_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  if (endpointQuery.isPending) {
    return (
      <section className="endpoint-overview-card" data-health="UNKNOWN" aria-label="Public endpoint health">
        <Globe2 size={20} aria-hidden="true" />
        <div className="endpoint-overview-card__summary">
          <strong>Public endpoint evidence loading</strong>
          <span>Current endpoint health is not known yet.</span>
        </div>
        <Link to="/activity"><Activity size={16} aria-hidden="true" /> Open endpoint activity</Link>
      </section>
    );
  }

  if (endpointQuery.isError || endpointQuery.data === undefined) {
    return (
      <section className="endpoint-overview-card" data-health="UNKNOWN" aria-label="Public endpoint health">
        <ShieldAlert size={20} aria-hidden="true" />
        <div className="endpoint-overview-card__summary">
          <strong>Public endpoint evidence unknown</strong>
          <span>The structured endpoint source is unavailable; this is not treated as all-clear.</span>
        </div>
        <Link to="/activity"><Activity size={16} aria-hidden="true" /> Open endpoint activity</Link>
      </section>
    );
  }

  const snapshot = endpointQuery.data;
  const attentionCount = snapshot.endpoints.filter(
    ({ state }) => state === "DOWN" || state === "DEGRADED",
  ).length;

  let heading = "Public endpoint evidence unknown";
  let summary = "No current endpoint state is present in the structured evidence window.";
  let Icon = ShieldAlert;

  if (snapshot.health === "ATTENTION") {
    heading = "Public endpoints need attention";
    summary = `${attentionCount} endpoint${attentionCount === 1 ? "" : "s"} currently down or degraded.`;
  } else if (snapshot.health === "HEALTHY") {
    heading = "Public endpoints healthy";
    summary = `${snapshot.endpoints.length} high-value endpoint${snapshot.endpoints.length === 1 ? "" : "s"} currently known up.`;
    Icon = CircleCheck;
  } else if (snapshot.endpoints.length > 0) {
    summary = "At least one current endpoint state is unknown; this is not treated as all-clear.";
  }

  return (
    <section className="endpoint-overview-card" data-health={snapshot.health} aria-label="Public endpoint health">
      <Icon size={20} aria-hidden="true" />
      <div className="endpoint-overview-card__summary">
        <strong>{heading}</strong>
        <span>{summary}</span>
      </div>
      {snapshot.endpoints.length > 0 ? (
        <ul className="endpoint-overview-list" aria-label="Current public endpoints">
          {snapshot.endpoints.map((endpoint) => (
            <li key={endpoint.endpointId} data-state={endpoint.state}>
              <div>
                <strong>{endpoint.label}</strong>
                <span>{formatDetail(endpoint.statusCode, endpoint.latencyMs)}</span>
              </div>
              <span className="endpoint-state">{endpoint.state === "UP" ? "Up" : endpoint.state === "DOWN" ? "Down" : endpoint.state === "DEGRADED" ? "Degraded" : "Unknown"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <Link to="/activity"><Activity size={16} aria-hidden="true" /> Open endpoint activity</Link>
    </section>
  );
}
