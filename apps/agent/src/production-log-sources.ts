import type { LogSourceId, LogSourcesSnapshot } from "@dashboard-rpi5/contracts/logs";

import { listRegisteredLogSources } from "./logs-read.js";
import {
  isPrivilegedLogSourceId,
  listPrivilegedLogSourceDescriptors,
  privilegedLogSourcesEnabled,
  PRIVILEGED_LOG_SOURCE_IDS,
} from "./privileged-log-sources.js";

export const DOCKER_PRODUCTION_LOG_SOURCE_IDS = Object.freeze<readonly LogSourceId[]>([
  "docker:homeassistant",
  "docker:prometheus",
]);

export const PRODUCTION_LOG_SOURCE_IDS = Object.freeze<readonly LogSourceId[]>([
  ...DOCKER_PRODUCTION_LOG_SOURCE_IDS,
  ...PRIVILEGED_LOG_SOURCE_IDS,
]);

const dockerProductionIds = new Set<LogSourceId>(DOCKER_PRODUCTION_LOG_SOURCE_IDS);

export function isProductionLogSourceId(
  sourceId: LogSourceId,
  privilegedEnabled: boolean = privilegedLogSourcesEnabled(),
): boolean {
  if (dockerProductionIds.has(sourceId)) return true;
  return privilegedEnabled && isPrivilegedLogSourceId(sourceId);
}

export function listProductionLogSources(
  now: Date = new Date(),
  privilegedEnabled: boolean = privilegedLogSourcesEnabled(),
): LogSourcesSnapshot {
  const snapshot = listRegisteredLogSources(now);
  const dockerSources = snapshot.sources.filter((source) => dockerProductionIds.has(source.sourceId));
  return {
    observedAt: snapshot.observedAt,
    sources: privilegedEnabled ? [...dockerSources, ...listPrivilegedLogSourceDescriptors()] : dockerSources,
  };
}
