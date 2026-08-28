import type {
  LogSourceDescriptor,
  LogSourceId,
  LogSourcesSnapshot,
} from "@dashboard-rpi5/contracts/logs";

export const PRODUCTION_LOG_SOURCES = Object.freeze<readonly LogSourceDescriptor[]>([
  { sourceId: "docker:homeassistant", label: "Home Assistant", kind: "DOCKER", rangeMode: "TIME" },
  { sourceId: "docker:prometheus", label: "Prometheus", kind: "DOCKER", rangeMode: "TIME" },
  { sourceId: "systemd:docker", label: "Docker Engine", kind: "SYSTEMD", rangeMode: "TIME" },
  { sourceId: "systemd:ssh", label: "SSH", kind: "SYSTEMD", rangeMode: "TIME" },
  { sourceId: "systemd:cron", label: "Cron scheduler", kind: "SYSTEMD", rangeMode: "TIME" },
  { sourceId: "systemd:dashboard-rpi5-agent", label: "Dashboard agent", kind: "SYSTEMD", rangeMode: "TIME" },
  { sourceId: "systemd:rpi5-update", label: "RPi5 maintenance", kind: "SYSTEMD", rangeMode: "TIME" },
  { sourceId: "systemd:cloudflared", label: "Cloudflare Tunnel", kind: "SYSTEMD", rangeMode: "TIME" },
  { sourceId: "systemd:rpi5-monitor", label: "RPi5 monitor", kind: "SYSTEMD", rangeMode: "TIME" },
  { sourceId: "systemd:rpi5-post-reboot", label: "RPi5 post-reboot", kind: "SYSTEMD", rangeMode: "TIME" },
  { sourceId: "systemd:rpi5-tmp-headroom", label: "RPi5 tmp headroom", kind: "SYSTEMD", rangeMode: "TIME" },
  { sourceId: "systemd:rpi5-dashboard-evidence", label: "RPi5 dashboard evidence", kind: "SYSTEMD", rangeMode: "TIME" },
  { sourceId: "systemd:hermes-tech-web", label: "Hermes Tech web", kind: "SYSTEMD", rangeMode: "TIME" },
  { sourceId: "journal:rpi5-deploy", label: "RPi5 deploy", kind: "JOURNAL", rangeMode: "TIME" },
  { sourceId: "file:rpi5-backup", label: "RPi5 backup", kind: "FILE", rangeMode: "TAIL" },
]);

export const PRODUCTION_LOG_SOURCE_IDS = Object.freeze<readonly LogSourceId[]>(
  PRODUCTION_LOG_SOURCES.map((source) => source.sourceId),
);

const productionLogSourceIds = new Set<LogSourceId>(PRODUCTION_LOG_SOURCE_IDS);
const productionLogSourcesById = new Map<LogSourceId, LogSourceDescriptor>(
  PRODUCTION_LOG_SOURCES.map((source) => [source.sourceId, source]),
);

export function isProductionLogSourceId(sourceId: LogSourceId): boolean {
  return productionLogSourceIds.has(sourceId);
}

export function getProductionLogSourceDescriptor(
  sourceId: LogSourceId,
): LogSourceDescriptor | undefined {
  const descriptor = productionLogSourcesById.get(sourceId);
  return descriptor === undefined ? undefined : { ...descriptor };
}

export function listProductionLogSources(now: Date = new Date()): LogSourcesSnapshot {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid log source observation time");
  return {
    observedAt: now.toISOString(),
    sources: PRODUCTION_LOG_SOURCES.map((source) => ({ ...source })),
  };
}
