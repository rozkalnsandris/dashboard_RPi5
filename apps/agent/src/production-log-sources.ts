import type { LogSourceId, LogSourcesSnapshot } from "@dashboard-rpi5/contracts/logs";

import { listRegisteredLogSources } from "./logs-read.js";

export const PRODUCTION_LOG_SOURCE_IDS = Object.freeze<readonly LogSourceId[]>([
  "docker:homeassistant",
  "docker:prometheus",
]);

const productionLogSourceIds = new Set<LogSourceId>(PRODUCTION_LOG_SOURCE_IDS);

export function isProductionLogSourceId(sourceId: LogSourceId): boolean {
  return productionLogSourceIds.has(sourceId);
}

export function listProductionLogSources(now: Date = new Date()): LogSourcesSnapshot {
  const snapshot = listRegisteredLogSources(now);
  return {
    observedAt: snapshot.observedAt,
    sources: snapshot.sources.filter((source) => isProductionLogSourceId(source.sourceId)),
  };
}
