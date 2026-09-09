import type {
  HistoryPoint,
  HistoryRange,
  HostHistoryMetric,
  HostHistorySeries,
  HostHistorySnapshot,
} from "@dashboard-rpi5/contracts/history";

export const HISTORY_RANGES: readonly HistoryRange[] = ["1h", "24h", "7d"];

export const HISTORY_METRICS = [
  "CPU_PERCENT",
  "CPU_USER_PERCENT",
  "CPU_SYSTEM_PERCENT",
  "CPU_IOWAIT_PERCENT",
  "MEMORY_PERCENT",
  "SWAP_PERCENT",
  "ROOT_FS_PERCENT",
  "LOAD1",
  "SOC_TEMP_CELSIUS",
  "NVME_TEMP_CELSIUS",
  "FAN_RPM",
  "FAN_PWM_PERCENT",
  "NETWORK_RX_BYTES_PER_SECOND",
  "NETWORK_TX_BYTES_PER_SECOND",
  "DISK_READ_BYTES_PER_SECOND",
  "DISK_WRITE_BYTES_PER_SECOND",
  "UPTIME_SECONDS",
] as const satisfies readonly HostHistoryMetric[];

const HISTORY_MAX_POINTS: Record<HistoryRange, number> = {
  "1h": 121,
  "24h": 289,
  "7d": 337,
};

const HISTORY_MAX_RESPONSE_CHARS = 2 * 1024 * 1024;

type HistoryMetricFormat = "PERCENT" | "TEMPERATURE" | "RPM" | "BYTES_PER_SECOND" | "LOAD" | "DURATION";
type HistoryMetricScale = "PERCENT" | "NONNEGATIVE" | "RANGE";

export interface HistoryMetricMeta {
  label: string;
  format: HistoryMetricFormat;
  scale: HistoryMetricScale;
}

export const HISTORY_METRIC_META: Record<HostHistoryMetric, HistoryMetricMeta> = {
  CPU_PERCENT: { label: "CPU busy", format: "PERCENT", scale: "PERCENT" },
  CPU_USER_PERCENT: { label: "CPU user", format: "PERCENT", scale: "PERCENT" },
  CPU_SYSTEM_PERCENT: { label: "CPU system", format: "PERCENT", scale: "PERCENT" },
  CPU_IOWAIT_PERCENT: { label: "CPU iowait", format: "PERCENT", scale: "PERCENT" },
  MEMORY_PERCENT: { label: "RAM used", format: "PERCENT", scale: "PERCENT" },
  SWAP_PERCENT: { label: "Swap used", format: "PERCENT", scale: "PERCENT" },
  ROOT_FS_PERCENT: { label: "Root FS", format: "PERCENT", scale: "PERCENT" },
  LOAD1: { label: "Load 1m", format: "LOAD", scale: "NONNEGATIVE" },
  SOC_TEMP_CELSIUS: { label: "SoC temp", format: "TEMPERATURE", scale: "RANGE" },
  NVME_TEMP_CELSIUS: { label: "NVMe temp", format: "TEMPERATURE", scale: "RANGE" },
  FAN_RPM: { label: "Fan", format: "RPM", scale: "NONNEGATIVE" },
  FAN_PWM_PERCENT: { label: "Fan PWM", format: "PERCENT", scale: "PERCENT" },
  NETWORK_RX_BYTES_PER_SECOND: { label: "Network RX", format: "BYTES_PER_SECOND", scale: "NONNEGATIVE" },
  NETWORK_TX_BYTES_PER_SECOND: { label: "Network TX", format: "BYTES_PER_SECOND", scale: "NONNEGATIVE" },
  DISK_READ_BYTES_PER_SECOND: { label: "Disk read", format: "BYTES_PER_SECOND", scale: "NONNEGATIVE" },
  DISK_WRITE_BYTES_PER_SECOND: { label: "Disk write", format: "BYTES_PER_SECOND", scale: "NONNEGATIVE" },
  UPTIME_SECONDS: { label: "Uptime", format: "DURATION", scale: "RANGE" },
};

export interface HistoryMetricGroup {
  id: string;
  label: string;
  metrics: readonly HostHistoryMetric[];
}

export const HISTORY_GROUPS = [
  { id: "cpu", label: "CPU", metrics: ["CPU_PERCENT", "CPU_USER_PERCENT", "CPU_SYSTEM_PERCENT", "CPU_IOWAIT_PERCENT", "LOAD1"] },
  { id: "memory-storage", label: "Memory & storage", metrics: ["MEMORY_PERCENT", "SWAP_PERCENT", "ROOT_FS_PERCENT"] },
  { id: "thermals-cooling", label: "Thermals & cooling", metrics: ["SOC_TEMP_CELSIUS", "NVME_TEMP_CELSIUS", "FAN_RPM", "FAN_PWM_PERCENT"] },
  { id: "network", label: "Network", metrics: ["NETWORK_RX_BYTES_PER_SECOND", "NETWORK_TX_BYTES_PER_SECOND"] },
  { id: "disk", label: "Disk I/O", metrics: ["DISK_READ_BYTES_PER_SECOND", "DISK_WRITE_BYTES_PER_SECOND"] },
  { id: "host", label: "Host", metrics: ["UPTIME_SECONDS"] },
] as const satisfies readonly HistoryMetricGroup[];

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
  return typeof value === "string" && (HISTORY_METRICS as readonly string[]).includes(value);
}

function metricValueIsValid(metric: HostHistoryMetric, value: number): boolean {
  if (!Number.isFinite(value)) return false;

  switch (metric) {
    case "CPU_PERCENT":
    case "CPU_USER_PERCENT":
    case "CPU_SYSTEM_PERCENT":
    case "CPU_IOWAIT_PERCENT":
    case "MEMORY_PERCENT":
    case "SWAP_PERCENT":
    case "ROOT_FS_PERCENT":
    case "FAN_PWM_PERCENT":
      return value >= 0 && value <= 100;
    case "SOC_TEMP_CELSIUS":
    case "NVME_TEMP_CELSIUS":
      return value >= -273.15 && value <= 250;
    case "LOAD1":
    case "FAN_RPM":
    case "NETWORK_RX_BYTES_PER_SECOND":
    case "NETWORK_TX_BYTES_PER_SECOND":
    case "DISK_READ_BYTES_PER_SECOND":
    case "DISK_WRITE_BYTES_PER_SECOND":
    case "UPTIME_SECONDS":
      return value >= 0;
  }
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
    value.series.length !== HISTORY_METRICS.length
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
  if (
    metrics.size !== HISTORY_METRICS.length ||
    HISTORY_METRICS.some((metric) => !metrics.has(metric))
  ) {
    throw new Error("Invalid history response");
  }

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

function sparklineDomain(metric: HostHistoryMetric, values: readonly number[]): { lower: number; upper: number } {
  const scale = HISTORY_METRIC_META[metric].scale;
  if (scale === "PERCENT") return { lower: 0, upper: 100 };
  if (scale === "NONNEGATIVE") return { lower: 0, upper: Math.max(1, ...values) };

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = Math.max((maximum - minimum) * 0.1, 1);
  return { lower: minimum - padding, upper: maximum + padding };
}

export function buildSparklinePoints(series: HostHistorySeries, width = 160, height = 48): string {
  if (series.state !== "AVAILABLE" || series.points.length === 0) return "";
  const values = series.points.map((point) => point.value);
  const { lower, upper } = sparklineDomain(series.metric, values);
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

function formatByteRate(value: number): string {
  const units = ["B/s", "KiB/s", "MiB/s", "GiB/s", "TiB/s"] as const;
  let scaled = value;
  let unitIndex = 0;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex === 0 ? 0 : scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatDuration(value: number): string {
  let seconds = Math.floor(value);
  const days = Math.floor(seconds / 86_400);
  seconds -= days * 86_400;
  const hours = Math.floor(seconds / 3_600);
  seconds -= hours * 3_600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

export function formatHistoryValue(metric: HostHistoryMetric, value: number): string {
  switch (HISTORY_METRIC_META[metric].format) {
    case "PERCENT":
      return `${value.toFixed(1)}%`;
    case "TEMPERATURE":
      return `${value.toFixed(1)}°C`;
    case "RPM":
      return `${value.toFixed(0)} RPM`;
    case "BYTES_PER_SECOND":
      return formatByteRate(value);
    case "LOAD":
      return value.toFixed(2);
    case "DURATION":
      return formatDuration(value);
  }
}
