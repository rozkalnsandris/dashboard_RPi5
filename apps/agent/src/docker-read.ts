import type {
  DockerContainerSnapshot,
  DockerContainerState,
  DockerContainersSnapshot,
  DockerHealthStatus,
  DockerResourceStats,
} from "@dashboard-rpi5/contracts";

import {
  DOCKER_API_VERSION,
  DOCKER_CONTAINER_CONCURRENCY,
  isDockerContainerId,
} from "./docker-api.js";
import { selectDockerApiVersion } from "./docker-api-version.js";
import {
  createDockerBrokerTransport,
  DockerBrokerRequestError,
  type DockerBrokerTransport,
} from "./docker-broker-client.js";

export {
  DOCKER_API_PREFIX,
  DOCKER_API_VERSION,
  DOCKER_CONTAINER_CONCURRENCY,
  DOCKER_MAX_RESPONSE_BYTES,
  DOCKER_REQUEST_TIMEOUT_MS,
} from "./docker-api.js";

const ZERO_TIME_PREFIX = "0001-01-01T00:00:00";

export class DockerSourceUnavailableError extends Error {
  constructor() {
    super("Required Docker evidence is unavailable");
    this.name = "DockerSourceUnavailableError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new DockerSourceUnavailableError();
  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DockerSourceUnavailableError();
  }
  return value;
}

function requireFiniteNonNegative(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new DockerSourceUnavailableError();
  }
  return value;
}

function optionalFiniteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function requireNonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new DockerSourceUnavailableError();
  }
  return value as number;
}

function toIsoDate(value: unknown): string {
  const raw = requireString(value);
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) throw new DockerSourceUnavailableError();
  return parsed.toISOString();
}

interface DockerVersionEvidence {
  engineVersion: string;
  daemonApiVersion: string;
  daemonMinApiVersion: string;
}

export function parseDockerVersion(value: unknown): DockerVersionEvidence {
  const record = requireRecord(value);
  const engineVersion = requireString(record.Version);
  const daemonApiVersion = requireString(record.ApiVersion);
  const daemonMinApiVersion = requireString(record.MinAPIVersion);

  try {
    selectDockerApiVersion(record);
  } catch {
    throw new DockerSourceUnavailableError();
  }

  return { engineVersion, daemonApiVersion, daemonMinApiVersion };
}

export function parseDockerContainerIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new DockerSourceUnavailableError();
  if (value.length > 512) throw new DockerSourceUnavailableError();

  const ids = value.map((entry) => {
    const id = requireString(requireRecord(entry).Id).toLowerCase();
    if (!isDockerContainerId(id)) throw new DockerSourceUnavailableError();
    return id;
  });

  return [...new Set(ids)].sort();
}

function normalizeState(value: unknown): DockerContainerState {
  switch (typeof value === "string" ? value.toLowerCase() : "") {
    case "created":
      return "CREATED";
    case "running":
      return "RUNNING";
    case "paused":
      return "PAUSED";
    case "restarting":
      return "RESTARTING";
    case "removing":
      return "REMOVING";
    case "exited":
      return "EXITED";
    case "dead":
      return "DEAD";
    default:
      return "UNKNOWN";
  }
}

function normalizeHealth(state: Record<string, unknown>): DockerHealthStatus {
  if (!("Health" in state) || state.Health === undefined || state.Health === null) {
    return "NONE";
  }

  const health = requireRecord(state.Health);
  switch (typeof health.Status === "string" ? health.Status.toLowerCase() : "") {
    case "healthy":
      return "HEALTHY";
    case "unhealthy":
      return "UNHEALTHY";
    case "starting":
      return "STARTING";
    default:
      return "UNKNOWN";
  }
}

interface DockerInspectEvidence {
  id: string;
  name: string;
  image: string;
  imageId: string;
  createdAt: string;
  state: DockerContainerState;
  health: DockerHealthStatus;
  restartCount: number;
  startedAt: string | null;
  running: boolean;
}

export function parseDockerInspect(value: unknown, expectedId: string): DockerInspectEvidence {
  if (!isDockerContainerId(expectedId)) throw new DockerSourceUnavailableError();

  const record = requireRecord(value);
  const id = requireString(record.Id).toLowerCase();
  if (id !== expectedId) throw new DockerSourceUnavailableError();

  const rawName = requireString(record.Name);
  const name = rawName.startsWith("/") ? rawName.slice(1) : rawName;
  if (name.length === 0 || name.length > 256) throw new DockerSourceUnavailableError();

  const stateRecord = requireRecord(record.State);
  const running = stateRecord.Running === true;
  const rawStartedAt = typeof stateRecord.StartedAt === "string" ? stateRecord.StartedAt : "";
  const startedAt =
    running && rawStartedAt.length > 0 && !rawStartedAt.startsWith(ZERO_TIME_PREFIX)
      ? toIsoDate(rawStartedAt)
      : null;

  const config = requireRecord(record.Config);

  return {
    id,
    name,
    image: requireString(config.Image),
    imageId: requireString(record.Image),
    createdAt: toIsoDate(record.Created),
    state: normalizeState(stateRecord.Status),
    health: normalizeHealth(stateRecord),
    restartCount: requireNonNegativeInteger(record.RestartCount),
    startedAt,
    running,
  };
}

export function calculateDockerCpuPercent(value: unknown): number | null {
  const root = requireRecord(value);
  const cpuStats = requireRecord(root.cpu_stats);
  const preCpuStats = requireRecord(root.precpu_stats);
  const cpuUsage = requireRecord(cpuStats.cpu_usage);
  const preCpuUsage = requireRecord(preCpuStats.cpu_usage);

  const total = optionalFiniteNonNegative(cpuUsage.total_usage);
  const previousTotal = optionalFiniteNonNegative(preCpuUsage.total_usage);
  const system = optionalFiniteNonNegative(cpuStats.system_cpu_usage);
  const previousSystem = optionalFiniteNonNegative(preCpuStats.system_cpu_usage);

  if (total === null || previousTotal === null || system === null || previousSystem === null) {
    return null;
  }

  const cpuDelta = total - previousTotal;
  const systemDelta = system - previousSystem;
  if (cpuDelta < 0 || systemDelta <= 0) return null;

  let onlineCpus = optionalFiniteNonNegative(cpuStats.online_cpus);
  if (onlineCpus === null || !Number.isSafeInteger(onlineCpus) || onlineCpus <= 0) {
    const perCpu = cpuUsage.percpu_usage;
    onlineCpus = Array.isArray(perCpu) && perCpu.length > 0 ? perCpu.length : null;
  }

  if (onlineCpus === null || onlineCpus <= 0) return null;

  const percent = (cpuDelta / systemDelta) * onlineCpus * 100;
  if (!Number.isFinite(percent) || percent < 0) return null;
  return Number(Math.min(100 * onlineCpus, percent).toFixed(2));
}

interface MemoryStats {
  usedBytes: number | null;
  limitBytes: number | null;
  percent: number | null;
}

export function calculateDockerMemory(value: unknown): MemoryStats {
  const root = requireRecord(value);
  const memory = isRecord(root.memory_stats) ? root.memory_stats : null;
  if (memory === null) return { usedBytes: null, limitBytes: null, percent: null };

  const usage = optionalFiniteNonNegative(memory.usage);
  const limit = optionalFiniteNonNegative(memory.limit);
  if (usage === null) return { usedBytes: null, limitBytes: limit, percent: null };

  const stats = isRecord(memory.stats) ? memory.stats : {};
  const cacheCandidates = [stats.inactive_file, stats.total_inactive_file, stats.cache];
  const cache = cacheCandidates
    .map(optionalFiniteNonNegative)
    .find((candidate): candidate is number => candidate !== null);

  const usedBytes = cache === undefined ? usage : cache <= usage ? usage - cache : null;
  if (usedBytes === null) return { usedBytes: null, limitBytes: limit, percent: null };

  const percent =
    limit !== null && limit > 0
      ? Number(Math.min(100, (usedBytes / limit) * 100).toFixed(2))
      : null;

  return { usedBytes, limitBytes: limit, percent };
}

interface NetworkStats {
  rxBytes: number | null;
  txBytes: number | null;
}

export function calculateDockerNetwork(value: unknown): NetworkStats {
  const root = requireRecord(value);
  if (!isRecord(root.networks)) return { rxBytes: null, txBytes: null };

  let rxBytes = 0;
  let txBytes = 0;
  for (const network of Object.values(root.networks)) {
    const record = requireRecord(network);
    rxBytes += requireFiniteNonNegative(record.rx_bytes);
    txBytes += requireFiniteNonNegative(record.tx_bytes);
  }

  if (!Number.isSafeInteger(rxBytes) || !Number.isSafeInteger(txBytes)) {
    return { rxBytes: null, txBytes: null };
  }

  return { rxBytes, txBytes };
}

interface BlockStats {
  readBytes: number | null;
  writeBytes: number | null;
}

export function calculateDockerBlockIo(value: unknown): BlockStats {
  const root = requireRecord(value);
  const blkio = isRecord(root.blkio_stats) ? root.blkio_stats : null;
  if (blkio === null || !("io_service_bytes_recursive" in blkio)) {
    return { readBytes: null, writeBytes: null };
  }

  const entries = blkio.io_service_bytes_recursive;
  if (entries === null) return { readBytes: null, writeBytes: null };
  if (!Array.isArray(entries)) throw new DockerSourceUnavailableError();

  let readBytes = 0;
  let writeBytes = 0;
  for (const entry of entries) {
    const record = requireRecord(entry);
    const operation = requireString(record.op).toLowerCase();
    const bytes = requireFiniteNonNegative(record.value);
    if (operation === "read") readBytes += bytes;
    if (operation === "write") writeBytes += bytes;
  }

  if (!Number.isSafeInteger(readBytes) || !Number.isSafeInteger(writeBytes)) {
    return { readBytes: null, writeBytes: null };
  }

  return { readBytes, writeBytes };
}

export function parseDockerStats(value: unknown): DockerResourceStats {
  const root = requireRecord(value);
  const memory = calculateDockerMemory(root);
  const network = calculateDockerNetwork(root);
  const block = calculateDockerBlockIo(root);
  const pidsStats = isRecord(root.pids_stats) ? root.pids_stats : null;
  const pids = pidsStats === null ? null : optionalFiniteNonNegative(pidsStats.current);

  return {
    cpuPercent: calculateDockerCpuPercent(root),
    memoryUsedBytes: memory.usedBytes,
    memoryLimitBytes: memory.limitBytes,
    memoryPercent: memory.percent,
    networkRxBytes: network.rxBytes,
    networkTxBytes: network.txBytes,
    blockReadBytes: block.readBytes,
    blockWriteBytes: block.writeBytes,
    pids: pids !== null && Number.isSafeInteger(pids) ? pids : null,
  };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value === undefined) continue;
      results[index] = await mapper(value);
    }
  });

  await Promise.all(workers);
  return results;
}

function calculateUptimeSeconds(startedAt: string | null, observedAt: Date): number | null {
  if (startedAt === null) return null;
  const startedMs = new Date(startedAt).getTime();
  const observedMs = observedAt.getTime();
  if (!Number.isFinite(startedMs) || startedMs > observedMs) return null;
  return Number(((observedMs - startedMs) / 1_000).toFixed(3));
}

export async function readDockerContainers(
  transport: DockerBrokerTransport = createDockerBrokerTransport(),
  signal?: AbortSignal,
  now: () => Date = () => new Date(),
): Promise<DockerContainersSnapshot> {
  try {
    signal?.throwIfAborted();

    await transport.ping(signal);
    const version = parseDockerVersion(await transport.version(signal));
    const ids = parseDockerContainerIds(await transport.listContainers(signal));
    const observedAt = now();
    if (!Number.isFinite(observedAt.getTime())) throw new DockerSourceUnavailableError();

    const containers = await mapWithConcurrency(
      ids,
      DOCKER_CONTAINER_CONCURRENCY,
      async (id): Promise<DockerContainerSnapshot | null> => {
        let inspect: DockerInspectEvidence;
        try {
          inspect = parseDockerInspect(await transport.inspectContainer(id, signal), id);
        } catch (error: unknown) {
          if (error instanceof DockerBrokerRequestError && error.statusCode === 404) return null;
          throw error;
        }

        let statsState: DockerContainerSnapshot["statsState"] = "NOT_RUNNING";
        let stats: DockerResourceStats | null = null;
        if (inspect.running) {
          try {
            stats = parseDockerStats(await transport.statsContainer(id, signal));
            statsState = "AVAILABLE";
          } catch {
            statsState = "UNAVAILABLE";
            stats = null;
          }
        }

        return {
          id: inspect.id,
          name: inspect.name,
          image: inspect.image,
          imageId: inspect.imageId,
          createdAt: inspect.createdAt,
          state: inspect.state,
          health: inspect.health,
          restartCount: inspect.restartCount,
          startedAt: inspect.startedAt,
          uptimeSeconds: calculateUptimeSeconds(inspect.startedAt, observedAt),
          statsState,
          stats,
        };
      },
    );

    signal?.throwIfAborted();

    return {
      observedAt: observedAt.toISOString(),
      apiVersion: DOCKER_API_VERSION,
      engineVersion: version.engineVersion,
      daemonApiVersion: version.daemonApiVersion,
      daemonMinApiVersion: version.daemonMinApiVersion,
      containers: containers.filter(
        (container): container is DockerContainerSnapshot => container !== null,
      ),
    };
  } catch (error: unknown) {
    if (error instanceof DockerSourceUnavailableError) throw error;
    throw new DockerSourceUnavailableError();
  }
}
