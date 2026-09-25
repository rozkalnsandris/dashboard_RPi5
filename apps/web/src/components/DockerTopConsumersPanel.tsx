import type {
  DockerHistoryMetric,
  DockerTopConsumer,
  DockerTopRanking,
  HistoryRange,
} from "@dashboard-rpi5/contracts/history";
import { useQuery } from "@tanstack/react-query";
import { LineChart, RefreshCw } from "lucide-react";
import { useState } from "react";

import {
  buildDockerHistorySparklinePoints,
  dockerIdentityLabel,
  DOCKER_HISTORY_RANGES,
  fetchDockerTopConsumers,
  formatDockerHistoryValue,
} from "../docker-history-ui";

const HISTORY_REFRESH_MS = 60_000;
const HISTORY_STALE_AFTER_MS = 120_000;

const METRIC_LABELS: Record<DockerHistoryMetric, string> = {
  CPU_PERCENT: "CPU",
  MEMORY_WORKING_SET_BYTES: "Memory working set",
};

function ConsumerCard({ metric, consumer }: { metric: DockerHistoryMetric; consumer: DockerTopConsumer }) {
  const label = dockerIdentityLabel(consumer.identity);
  return (
    <article className="history-metric" aria-label={`${label} ${METRIC_LABELS[metric]} history`}>
      <div className="history-metric__heading">
        <span>{label}</span>
        <span className="history-state history-state--available">Available</span>
      </div>
      <div className="history-metric__value-row">
        <strong>{formatDockerHistoryValue(metric, consumer.latest)}</strong>
        <span>
          avg {formatDockerHistoryValue(metric, consumer.average)} · max {formatDockerHistoryValue(metric, consumer.maximum)}
        </span>
      </div>
      <svg
        className="history-sparkline"
        viewBox="0 0 160 48"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <polyline points={buildDockerHistorySparklinePoints(consumer)} vectorEffect="non-scaling-stroke" />
      </svg>
    </article>
  );
}

function RankingGroup({ ranking, range }: { ranking: DockerTopRanking; range: HistoryRange }) {
  const label = METRIC_LABELS[ranking.metric];
  return (
    <section className="history-group" aria-labelledby={`docker-history-${ranking.metric}`}>
      <h3 id={`docker-history-${ranking.metric}`} className="history-group__heading">
        {label}
      </h3>
      {ranking.state === "UNAVAILABLE" ? (
        <div className="history-message history-message--warning" role="status">
          <strong>{label} history unavailable</strong>
          <span>No trustworthy container series were available for the {range} window.</span>
        </div>
      ) : (
        <div className="history-grid" aria-label={`${range} ${label} top consumers`}>
          {ranking.consumers.map((consumer) => (
            <ConsumerCard
              key={dockerIdentityLabel(consumer.identity)}
              metric={ranking.metric}
              consumer={consumer}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function DockerTopConsumersPanel() {
  const [range, setRange] = useState<HistoryRange>("24h");
  const query = useQuery({
    queryKey: ["docker-top-consumers", range],
    queryFn: ({ signal }) => fetchDockerTopConsumers(range, signal),
    staleTime: 30_000,
    refetchInterval: HISTORY_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  const ageMs = query.data === undefined ? 0 : Date.now() - Date.parse(query.data.observedAt);
  const stale = query.data !== undefined && ageMs > HISTORY_STALE_AFTER_MS;
  const degraded = query.isError && query.data !== undefined;

  return (
    <section className="panel history-panel" aria-labelledby="docker-history-title">
      <div className="history-panel__topline">
        <div>
          <p className="eyebrow">Prometheus history · normalized Compose identity</p>
          <h2 id="docker-history-title">Top consumers</h2>
        </div>
        <LineChart size={19} aria-hidden="true" />
      </div>
      <p>Historical CPU and memory evidence is separate from the live Docker Engine snapshot above.</p>

      <div className="history-toolbar">
        <div className="history-range" role="group" aria-label="Docker history range">
          {DOCKER_HISTORY_RANGES.map((candidate) => (
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
          <strong>Loading Docker history…</strong>
          <span>Waiting for bounded Prometheus evidence.</span>
        </div>
      ) : null}

      {query.isError && query.data === undefined ? (
        <div className="history-message history-message--warning" role="status">
          <strong>Docker history unavailable</strong>
          <span>No fixture values are substituted and no zero values are fabricated.</span>
        </div>
      ) : null}

      {query.data !== undefined ? (
        <>
          {stale || degraded ? (
            <div className="history-message history-message--warning" role="status">
              <strong>{degraded ? "Latest history refresh failed" : "Docker history snapshot is stale"}</strong>
              <span>Showing the last trustworthy snapshot while keeping degraded state explicit.</span>
            </div>
          ) : null}
          <div className="history-groups">
            {query.data.rankings.map((ranking) => (
              <RankingGroup key={ranking.metric} ranking={ranking} range={range} />
            ))}
          </div>
          <footer className="history-footer">
            <span>
              Observed {new Date(query.data.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span>Top 5 by window average · server-owned queries</span>
          </footer>
        </>
      ) : null}
    </section>
  );
}
