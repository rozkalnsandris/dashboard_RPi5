import type { HistoryRange, HostHistorySeries } from "@dashboard-rpi5/contracts/history";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, LineChart, RefreshCw } from "lucide-react";
import { useState } from "react";

import {
  buildSparklinePoints,
  fetchHostHistory,
  formatHistoryValue,
  getSeriesStats,
  HISTORY_METRIC_META,
  HISTORY_RANGES,
} from "../history-ui";

const HISTORY_REFRESH_MS = 60_000;
const HISTORY_STALE_AFTER_MS = 120_000;

function HistorySparkline({ series }: { series: HostHistorySeries }) {
  const stats = getSeriesStats(series);
  const meta = HISTORY_METRIC_META[series.metric];

  if (stats === null) {
    return (
      <article className="history-metric history-metric--unavailable">
        <div className="history-metric__heading">
          <span>{meta.label}</span>
          <span className="history-state">Unavailable</span>
        </div>
        <strong>—</strong>
        <p>No trustworthy samples in this window.</p>
      </article>
    );
  }

  return (
    <article className="history-metric">
      <div className="history-metric__heading">
        <span>{meta.label}</span>
        <span className="history-state history-state--available">Available</span>
      </div>
      <div className="history-metric__value-row">
        <strong>{formatHistoryValue(series.metric, stats.latest)}</strong>
        <span>
          min {formatHistoryValue(series.metric, stats.minimum)} · max {formatHistoryValue(series.metric, stats.maximum)}
        </span>
      </div>
      <svg
        className="history-sparkline"
        viewBox="0 0 160 48"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <polyline points={buildSparklinePoints(series)} vectorEffect="non-scaling-stroke" />
      </svg>
    </article>
  );
}

export function HistoryPanel() {
  const [range, setRange] = useState<HistoryRange>("24h");
  const query = useQuery({
    queryKey: ["host-history", range],
    queryFn: ({ signal }) => fetchHostHistory(range, signal),
    staleTime: 30_000,
    refetchInterval: HISTORY_REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  const ageMs = query.data === undefined ? 0 : Date.now() - Date.parse(query.data.observedAt);
  const stale = query.data !== undefined && ageMs > HISTORY_STALE_AFTER_MS;
  const degraded = query.isError && query.data !== undefined;

  return (
    <section className="panel history-panel" aria-labelledby="history-title">
      <div className="history-panel__topline">
        <div>
          <p className="eyebrow">Prometheus history</p>
          <h2 id="history-title">Host trends</h2>
        </div>
        <LineChart size={19} aria-hidden="true" />
      </div>

      <div className="history-toolbar">
        <div className="history-range" role="group" aria-label="History range">
          {HISTORY_RANGES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={candidate === range ? "history-range__button is-active" : "history-range__button"}
              aria-pressed={candidate === range}
              onClick={() => setRange(candidate)}
            >
              {candidate}
            </button>
          ))}
        </div>
        <span className="history-refresh" aria-live="polite">
          {query.isFetching ? <RefreshCw size={14} aria-hidden="true" /> : null}
          {query.isFetching ? "Refreshing" : "60s refresh"}
        </span>
      </div>

      {query.isPending ? (
        <div className="history-message" role="status">
          <strong>Loading host history…</strong>
          <span>Waiting for bounded Prometheus evidence.</span>
        </div>
      ) : null}

      {query.isError && query.data === undefined ? (
        <div className="history-message history-message--warning" role="status">
          <strong>History unavailable</strong>
          <span>No cached values are substituted and no zero values are fabricated.</span>
        </div>
      ) : null}

      {query.data !== undefined ? (
        <>
          {stale || degraded ? (
            <div className="history-message history-message--warning" role="status">
              <strong>{degraded ? "Latest refresh failed" : "History snapshot is stale"}</strong>
              <span>Showing the last trustworthy snapshot instead of replacing it with unknown values.</span>
            </div>
          ) : null}

          <div className="history-grid" aria-label={`${range} host history`}>
            {query.data.series.map((series) => (
              <HistorySparkline key={series.metric} series={series} />
            ))}
          </div>

          <footer className="history-footer">
            <span>
              Observed {new Date(query.data.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            {query.data.grafanaHref === null ? (
              <span>Grafana link not configured</span>
            ) : (
              <a href={query.data.grafanaHref} target="_blank" rel="noreferrer">
                Open in Grafana <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
          </footer>
        </>
      ) : null}
    </section>
  );
}
