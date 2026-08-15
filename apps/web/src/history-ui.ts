import type {
  HistoryPoint,
  HistoryRange,
  HostHistoryMetric,
  HostHistorySeries,
  HostHistorySnapshot,
} from "@dashboard-rpi5/contracts/history";

export const HISTORY_RANGES: readonly HistoryRange[] = ["1h", "24h", "7d"];

const HISTORY_MAX_POINTS: Record<HistoryRange, number> = {
  "1h": 121,
  "24h": 289,
  "7d": 337,
};

const HISTORY_MAX_RESPONSE_CHARS = 2 * 1024 * 1024;

export const HISTORY_METRIC_META: Record<
  HostHistoryMetric,
  { label: string; unit: string; decimals: number }
> = {
  CPU_PERCENT: { label: "CPU", unit: "%", decimals: 1 },
  MEMORY_PERCENT: { label: "RAM", unit: "%", decimals: 1 },
  ROOT_FS_PERCENT: { label: "Root FS", unit: "%", decimals: 1 },
  LOAD1: { label: "Load 1m", unit: "", decimals: 2 },
};

interface SeriesStats {
  latest: number;
  minimum: number;
  maximum: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHistoryRange(value: unknown): value is HistoryRange {
  return HISTORY_RANGES.includes(value as HistoryRange);
}

function isMetric(value: unknown): value is HostHistoryMetric {
  return value === "CPU_PERCENT" || value === "MEMORY_PERCENT" || value === "ROOT_FS_PERCENT" || value === "LOAD1";
}

function metricValueIsValid(metric: HostHistoryMetric, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (metric === "LOAD1") return value >= 0;
  return value >= 0 && value <= 100;
}

function parsePoint(value: unknown, metric: HostHistoryMetric): HistoryPoint | null {
  if (!isRecord(value) || typeof value.timestamp !== "string" || typeof value.value !== "number") return null;
  if (!metricValueIsValid(metric, value.value) || !Number.isFinite(Date.parse(value.timestamp))) return null;
  return { timestamp: value.timestamp, value: value.value };
}

function parseSeries(value: unknown, maxPoints: number): HostHistorySeries | null {
  if (!isRecord(value) || !isMetric(value.metric)) return null;
  if (value.state !== "AVAILABLE" && value.state !== "UNAVAILABLE") return null;
  if (!Array.isArray(value.points) || value.points.length > maxPoints) return null;

  const points: HistoryPoint[] = [];
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const point of value.points) {
    const parsed = parsePoint(point, value.metric);
    if (parsed === null) return null;
    const timestamp = Date.parse(parsed.timestamp);
    if (timestamp <= previousTimestamp) return null;
    previousTimestamp = timestamp;
    points.push(parsed);
  }

  if (value.state === "AVAILABLE" && points.length === 0) return null;
  if (value.state === "UNAVAILABLE" && points.length !== 0) return null;
  return { metric: value.metric, state: value.state, points };
}

function parseGrafanaHref(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 2048) throw new Error("Invalid history response");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid history response");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("Invalid history response");
  }
  return url.toString();
}

export function parseHostHistorySnapshot(value: unknown): HostHistorySnapshot {
  if (!isRecord(value)) throw new Error("Invalid history response");
  if (
    typeof value.observedAt !== "string" ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    !isHistoryRange(value.range) ||
    typeof value.windowStart !== "string" ||
    !Number.isFinite(Date.parse(value.windowStart)) ||
    typeof value.windowEnd !== "string" ||
    !Number.isFinite(Date.parse(value.windowEnd)) ||
    !Array.isArray(value.series) ||
    value.series.length !== 4
  ) {
    throw new Error("Invalid history response");
  }

  const windowStart = Date.parse(value.windowStart);
  const windowEnd = Date.parse(value.windowEnd);
  const observedAt = Date.parse(value.observedAt);
  if (windowStart > windowEnd || observedAt < windowEnd) throw new Error("Invalid history response");

  const maxPoints = HISTORY_MAX_POINTS[value.range];
  const series = value.series.map((item) => parseSeries(item, maxPoints));
  if (series.some((item) => item === null)) throw new Error("Invalid history response");
  const typedSeries = series as HostHistorySeries[];
  const metrics = new Set(typedSeries.map((item) => item.metric));
  if (metrics.size !== 4) throw new Error("Invalid history response");

  for (const item of typedSeries) {
    for (const point of item.points) {
      const timestamp = Date.parse(point.timestamp);
      if (timestamp < windowStart || timestamp > windowEnd) throw new Error("Invalid history response");
    }
  }

  return {
    observedAt: value.observedAt,
    range: value.range,
    windowStart: value.windowStart,
    windowEnd: value.windowEnd,
    series: typedSeries,
    grafanaHref: parseGrafanaHref(value.grafanaHref),
  };
}

export async function fetchHostHistory(range: HistoryRange, signal?: AbortSignal): Promise<HostHistorySnapshot> {
  if (!isHistoryRange(range)) throw new Error("Unsupported history range");
  const response = await fetch(`/api/history/host?range=${range}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error("History source unavailable");

  const raw = await response.text();
  if (raw.length > HISTORY_MAX_RESPONSE_CHARS) throw new Error("History source unavailable");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new Error("History source unavailable");
  }

  const snapshot = parseHostHistorySnapshot(parsedJson);
  if (snapshot.range !== range) throw new Error("History source unavailable");
  return snapshot;
}

export function getSeriesStats(series: HostHistorySeries): SeriesStats | null {
  if (series.state !== "AVAILABLE" || series.points.length === 0) return null;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const point of series.points) {
    minimum = Math.min(minimum, point.value);
    maximum = Math.max(maximum, point.value);
  }
  const latest = series.points.at(-1)?.value;
  if (latest === undefined) return null;
  return { latest, minimum, maximum };
}

export function buildSparklinePoints(series: HostHistorySeries, width = 160, height = 48): string {
  if (series.state !== "AVAILABLE" || series.points.length === 0) return "";
  const values = series.points.map((point) => point.value);
  const percentageMetric = series.metric !== "LOAD1";
  const lower = percentageMetric ? 0 : Math.min(0, ...values);
  const upper = percentageMetric ? 100 : Math.max(1, ...values);
  const span = Math.max(upper - lower, Number.EPSILON);
  const denominator = Math.max(series.points.length - 1, 1);

  return series.points
    .map((point, index) => {
      const x = (index / denominator) * width;
      const ratio = (point.value - lower) / span;
      const y = height - Math.max(0, Math.min(1, ratio)) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function formatHistoryValue(metric: HostHistoryMetric, value: number): string {
  const meta = HISTORY_METRIC_META[metric];
  return `${value.toFixed(meta.decimals)}${meta.unit}`;
}
