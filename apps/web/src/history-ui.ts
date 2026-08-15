import type {
  HistoryPoint,
  HistoryRange,
  HostHistoryMetric,
  HostHistorySeries,
  HostHistorySnapshot,
} from "@dashboard-rpi5/contracts/history";

export const HISTORY_RANGES: readonly HistoryRange[] = ["1h", "24h", "7d"];

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

function parsePoint(value: unknown): HistoryPoint | null {
  if (!isRecord(value) || typeof value.timestamp !== "string" || typeof value.value !== "number") return null;
  if (!Number.isFinite(value.value) || !Number.isFinite(Date.parse(value.timestamp))) return null;
  return { timestamp: value.timestamp, value: value.value };
}

function parseSeries(value: unknown): HostHistorySeries | null {
  if (!isRecord(value) || !isMetric(value.metric)) return null;
  if (value.state !== "AVAILABLE" && value.state !== "UNAVAILABLE") return null;
  if (!Array.isArray(value.points) || value.points.length > 337) return null;

  const points: HistoryPoint[] = [];
  for (const point of value.points) {
    const parsed = parsePoint(point);
    if (parsed === null) return null;
    points.push(parsed);
  }

  if (value.state === "AVAILABLE" && points.length === 0) return null;
  if (value.state === "UNAVAILABLE" && points.length !== 0) return null;
  return { metric: value.metric, state: value.state, points };
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
    value.series.length !== 4 ||
    !(typeof value.grafanaHref === "string" || value.grafanaHref === null)
  ) {
    throw new Error("Invalid history response");
  }

  const series = value.series.map(parseSeries);
  if (series.some((item) => item === null)) throw new Error("Invalid history response");
  const typedSeries = series as HostHistorySeries[];
  const metrics = new Set(typedSeries.map((item) => item.metric));
  if (metrics.size !== 4) throw new Error("Invalid history response");

  return {
    observedAt: value.observedAt,
    range: value.range,
    windowStart: value.windowStart,
    windowEnd: value.windowEnd,
    series: typedSeries,
    grafanaHref: value.grafanaHref,
  };
}

export async function fetchHostHistory(range: HistoryRange, signal?: AbortSignal): Promise<HostHistorySnapshot> {
  if (!isHistoryRange(range)) throw new Error("Unsupported history range");
  const response = await fetch(`/api/history/host?range=${range}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error("History source unavailable");
  return parseHostHistorySnapshot(await response.json());
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
