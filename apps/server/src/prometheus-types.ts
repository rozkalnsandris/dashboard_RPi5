export const PROMETHEUS_DEFAULT_BASE_URL = "http://127.0.0.1:9090";
export const PROMETHEUS_QUERY_RANGE_PATH = "/api/v1/query_range";
export const PROMETHEUS_REQUEST_TIMEOUT_MS = 3_000;
export const PROMETHEUS_QUERY_TIMEOUT = "2s";
export const PROMETHEUS_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class PrometheusSourceUnavailableError extends Error {
  constructor() {
    super("Prometheus source unavailable");
    this.name = "PrometheusSourceUnavailableError";
  }
}

export interface PrometheusQueryRangeRequest {
  query: string;
  startEpochSeconds: number;
  endEpochSeconds: number;
  stepSeconds: number;
}

export interface PrometheusTransport {
  read(request: PrometheusQueryRangeRequest, signal?: AbortSignal): Promise<unknown>;
}
