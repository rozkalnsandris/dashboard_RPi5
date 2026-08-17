import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ShieldAlert } from "lucide-react";

import { CurrentDockerView } from "../components/CurrentDockerView";
import { fetchCurrentDocker } from "../current-state-api";

const REFRESH_MS = 10_000;
const STALE_AFTER_MS = 30_000;

export function LiveDockerPage() {
  const query = useQuery({
    queryKey: ["current-docker"],
    queryFn: ({ signal }) => fetchCurrentDocker(signal),
    staleTime: 5_000,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  const stale = query.data !== undefined && Date.now() - Date.parse(query.data.observedAt) > STALE_AFTER_MS;
  const degraded = query.isRefetchError && query.data !== undefined;

  return (
    <section className="page-stack" aria-labelledby="docker-page-title">
      <div className="page-heading">
        <p className="eyebrow">Docker Engine · live read-only</p>
        <h1 id="docker-page-title">Docker containers</h1>
        <p>Current normalized Engine evidence from the local agent. No restart, stop, exec, remove or generic Docker API proxy is exposed.</p>
      </div>

      {query.isPending ? (
        <div className="attention-card" role="status">
          <RefreshCw size={18} aria-hidden="true" />
          <div><strong>Checking Docker state…</strong><p>Waiting for bounded local-agent evidence.</p></div>
        </div>
      ) : null}

      {query.isError && query.data === undefined ? (
        <div className="attention-card" role="status">
          <ShieldAlert size={18} aria-hidden="true" />
          <div><strong>Docker evidence unavailable</strong><p>No fixture container data is shown as a fallback.</p></div>
          <span className="count-pill">Unknown</span>
        </div>
      ) : null}

      {query.data !== undefined ? (
        <>
          {stale || degraded ? (
            <div className="attention-card" role="status">
              <ShieldAlert size={18} aria-hidden="true" />
              <div><strong>{degraded ? "Latest Docker refresh failed" : "Docker evidence is stale"}</strong><p>Showing the last trustworthy snapshot while keeping degraded state explicit.</p></div>
              <span className="count-pill">Attention</span>
            </div>
          ) : null}
          <div className="panel">
            <CurrentDockerView containers={query.data.containers} />
          </div>
          <div className="panel">
            <span>Observed {new Date(query.data.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            <span> · Engine {query.data.engineVersion}</span>
            <span> · {query.isFetching ? "refreshing" : "10s refresh"}</span>
          </div>
        </>
      ) : null}
    </section>
  );
}
