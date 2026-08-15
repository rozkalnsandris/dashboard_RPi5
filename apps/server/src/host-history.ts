import type { HistoryRange, HostHistorySnapshot } from "@dashboard-rpi5/contracts/history";

import { buildGrafanaHistoryHref } from "./grafana-link.js";
import { HISTORY_RANGE_POLICY, HOST_HISTORY_METRICS } from "./history-policy.js";
import { createPrometheusHttpTransport } from "./prometheus-client.js";
import { normalizePrometheusMatrix } from "./prometheus-normalize.js";
import { buildHostPromqlRegistry } from "./prometheus-query-registry.js";
import {
  PROMETHEUS_DEFAULT_BASE_URL,
  PrometheusSourceUnavailableError,
  type PrometheusTransport,
} from "./prometheus-types.js";

export interface HostHistoryReaderOptions {
  prometheusBaseUrl?: string;
  nodeInstance?: string;
  grafanaBaseUrl?: string;
  grafanaDashboardPath?: string;
  transport?: PrometheusTransport;
  now?: () => Date;
}

export type HostHistoryReader = (
  range: HistoryRange,
  signal?: AbortSignal,
) => Promise<HostHistorySnapshot>;

export function createHostHistoryReader(options: HostHistoryReaderOptions = {}): HostHistoryReader {
  const registry = buildHostPromqlRegistry(options.nodeInstance);
  const transport =
    options.transport ??
    createPrometheusHttpTransport(options.prometheusBaseUrl ?? PROMETHEUS_DEFAULT_BASE_URL);
  const now = options.now ?? (() => new Date());

  return async (range, signal) => {
    try {
      signal?.throwIfAborted();
      const policy = HISTORY_RANGE_POLICY[range];
      if (policy === undefined) throw new PrometheusSourceUnavailableError();

      const observedAt = now();
      if (!Number.isFinite(observedAt.getTime())) throw new PrometheusSourceUnavailableError();

      const endEpochSeconds = Math.floor(observedAt.getTime() / 1_000);
      const startEpochSeconds = endEpochSeconds - policy.durationSeconds;

      const series = await Promise.all(
        HOST_HISTORY_METRICS.map(async (metric) => {
          const raw = await transport.read(
            {
              query: registry[metric],
              startEpochSeconds,
              endEpochSeconds,
              stepSeconds: policy.stepSeconds,
            },
            signal,
          );
          return normalizePrometheusMatrix(
            raw,
            metric,
            startEpochSeconds,
            endEpochSeconds,
            policy.maxPoints,
          );
        }),
      );

      signal?.throwIfAborted();

      return {
        observedAt: observedAt.toISOString(),
        range,
        windowStart: new Date(startEpochSeconds * 1_000).toISOString(),
        windowEnd: new Date(endEpochSeconds * 1_000).toISOString(),
        series,
        grafanaHref: buildGrafanaHistoryHref(
          options.grafanaBaseUrl,
          options.grafanaDashboardPath,
          range,
        ),
      };
    } catch (error: unknown) {
      if (error instanceof PrometheusSourceUnavailableError) throw error;
      throw new PrometheusSourceUnavailableError();
    }
  };
}
