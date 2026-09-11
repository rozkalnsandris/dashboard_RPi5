import {
  CONTAINER_METRICS_MAX_CONTAINERS,
  CONTAINER_METRICS_MAX_VALUE,
  CONTAINER_METRICS_SNAPSHOT_SCHEMA,
  containerMetricsIdentityKey,
  normalizeContainerMetricsIdentity,
  type ContainerMetricsIdentity,
  type ContainerMetricsSample,
  type ContainerMetricsSnapshot,
} from "./container-metrics-contract.js";
import { DOCKER_CONTAINER_CONCURRENCY, isDockerContainerId } from "./docker-api.js";

const COMPOSE_PROJECT_LABEL = "com.docker.compose.project";
const COMPOSE_SERVICE_LABEL = "com.docker.compose.service";
const COMPOSE_CONTAINER_NUMBER_LABEL = "com.docker.compose.container-number";

export const DOCKER_BROKER_CONTAINER_METRICS_CONCURRENCY = DOCKER_CONTAINER_CONCURRENCY;

export interface DockerContainerMetricsEngineReader {
  listContainers(signal?: AbortSignal): Promise<unknown>;
  inspectContainer(id: string, signal?: AbortSignal): Promise<unknown>;
  statsContainer(id: string, signal?: AbortSignal): Promise<unknown>;
}

export interface DockerContainerMetricsReader {
  readSnapshot(signal?: AbortSignal): Promise<ContainerMetricsSnapshot>;
}

interface DockerContainerMetricsReaderOptions {
  now?: () => Date;
  concurrency?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("malformed Docker metrics evidence");
  return value;
}

function optionalBoundedNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > CONTAINER_METRICS_MAX_VALUE
  ) {
    throw new Error("malformed Docker metrics evidence");
  }
  return Object.is(value, -0) ? 0 : value;
}

function requireDockerContainerIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > CONTAINER_METRICS_MAX_CONTAINERS) {
    throw new Error("malformed Docker container inventory");
  }

  const ids = value.map((entry) => {
    const record = requireRecord(entry);
    if (typeof record.Id !== "string") throw new Error("malformed Docker container inventory");
    const id = record.Id.toLowerCase();
    if (!isDockerContainerId(id)) throw new Error("malformed Docker container inventory");
    return id;
  });
  return [...new Set(ids)].sort();
}

function readComposeIdentity(labels: unknown): ContainerMetricsIdentity | null {
  if (labels === undefined || labels === null) return null;
  if (!isRecord(labels)) throw new Error("malformed Docker inspect labels");

  return normalizeContainerMetricsIdentity(
    labels[COMPOSE_PROJECT_LABEL],
    labels[COMPOSE_SERVICE_LABEL],
    labels[COMPOSE_CONTAINER_NUMBER_LABEL],
  );
}

function readRunningIdentity(value: unknown, expectedId: string): ContainerMetricsIdentity | null {
  const root = requireRecord(value);
  if (typeof root.Id !== "string" || root.Id.toLowerCase() !== expectedId) {
    throw new Error("malformed Docker inspect evidence");
  }

  const state = requireRecord(root.State);
  if (typeof state.Running !== "boolean") throw new Error("malformed Docker inspect evidence");
  if (!state.Running) return null;

  const config = requireRecord(root.Config);
  return readComposeIdentity(config.Labels);
}

function readCpuUsageSeconds(root: Record<string, unknown>): number | null {
  if (root.cpu_stats === undefined || root.cpu_stats === null) return null;
  const cpuStats = requireRecord(root.cpu_stats);
  if (cpuStats.cpu_usage === undefined || cpuStats.cpu_usage === null) return null;
  const cpuUsage = requireRecord(cpuStats.cpu_usage);
  const totalUsage = optionalBoundedNumber(cpuUsage.total_usage);
  return totalUsage === null ? null : totalUsage / 1_000_000_000;
}

function readMemoryWorkingSetBytes(root: Record<string, unknown>): number | null {
  if (root.memory_stats === undefined || root.memory_stats === null) return null;
  const memory = requireRecord(root.memory_stats);
  const usage = optionalBoundedNumber(memory.usage);
  if (usage === null) return null;

  let cache: number | null = null;
  if (memory.stats !== undefined && memory.stats !== null) {
    const stats = requireRecord(memory.stats);
    for (const key of ["inactive_file", "total_inactive_file", "cache"] as const) {
      const candidate = optionalBoundedNumber(stats[key]);
      if (candidate !== null) {
        cache = candidate;
        break;
      }
    }
  }

  if (cache === null) return usage;
  return cache <= usage ? usage - cache : null;
}

function readNetworkBytes(
  root: Record<string, unknown>,
): { receive: number; transmit: number } | null {
  if (root.networks === undefined || root.networks === null) return null;
  const networks = requireRecord(root.networks);
  let receive = 0;
  let transmit = 0;

  for (const network of Object.values(networks)) {
    const record = requireRecord(network);
    const rx = optionalBoundedNumber(record.rx_bytes);
    const tx = optionalBoundedNumber(record.tx_bytes);
    if (rx === null || tx === null) return null;
    receive += rx;
    transmit += tx;
    if (
      !Number.isFinite(receive) ||
      !Number.isFinite(transmit) ||
      receive > CONTAINER_METRICS_MAX_VALUE ||
      transmit > CONTAINER_METRICS_MAX_VALUE
    ) {
      throw new Error("malformed Docker network counters");
    }
  }

  return { receive, transmit };
}

function readFilesystemBytes(
  root: Record<string, unknown>,
): { read: number; write: number } | null {
  if (root.blkio_stats === undefined || root.blkio_stats === null) return null;
  const blkio = requireRecord(root.blkio_stats);
  const entries = blkio.io_service_bytes_recursive;
  if (entries === undefined || entries === null) return null;
  if (!Array.isArray(entries)) throw new Error("malformed Docker block I/O counters");

  let read = 0;
  let write = 0;
  let sawRead = false;
  let sawWrite = false;
  for (const entry of entries) {
    const record = requireRecord(entry);
    if (typeof record.op !== "string") throw new Error("malformed Docker block I/O counter");
    const operation = record.op.toLowerCase();
    if (operation !== "read" && operation !== "write") continue;
    const bytes = optionalBoundedNumber(record.value);
    if (bytes === null) throw new Error("malformed Docker block I/O counter");
    if (operation === "read") {
      sawRead = true;
      read += bytes;
    } else {
      sawWrite = true;
      write += bytes;
    }
  }

  if (!sawRead || !sawWrite) return null;
  if (
    !Number.isFinite(read) ||
    !Number.isFinite(write) ||
    read > CONTAINER_METRICS_MAX_VALUE ||
    write > CONTAINER_METRICS_MAX_VALUE
  ) {
    throw new Error("malformed Docker block I/O counters");
  }
  return { read, write };
}

function readMetrics(
  value: unknown,
): Omit<ContainerMetricsSample, "identity"> | null {
  const root = requireRecord(value);
  const cpuUsageSeconds = readCpuUsageSeconds(root);
  const memoryWorkingSetBytes = readMemoryWorkingSetBytes(root);
  const network = readNetworkBytes(root);
  const filesystem = readFilesystemBytes(root);
  if (
    cpuUsageSeconds === null ||
    memoryWorkingSetBytes === null ||
    network === null ||
    filesystem === null
  ) {
    return null;
  }

  return {
    cpuUsageSeconds,
    memoryWorkingSetBytes,
    networkReceiveBytes: network.receive,
    networkTransmitBytes: network.transmit,
    filesystemReadBytes: filesystem.read,
    filesystemWriteBytes: filesystem.write,
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

function compareSamples(left: ContainerMetricsSample, right: ContainerMetricsSample): number {
  const leftKey = containerMetricsIdentityKey(left.identity);
  const rightKey = containerMetricsIdentityKey(right.identity);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

export function createDockerContainerMetricsReader(
  engineReader: DockerContainerMetricsEngineReader,
  options: DockerContainerMetricsReaderOptions = {},
): DockerContainerMetricsReader {
  const requestedConcurrency = options.concurrency ?? DOCKER_BROKER_CONTAINER_METRICS_CONCURRENCY;
  if (!Number.isSafeInteger(requestedConcurrency) || requestedConcurrency <= 0) {
    throw new Error("invalid container metrics concurrency");
  }
  const concurrency = Math.min(
    requestedConcurrency,
    DOCKER_BROKER_CONTAINER_METRICS_CONCURRENCY,
  );
  const now = options.now ?? (() => new Date());

  return {
    async readSnapshot(signal?: AbortSignal): Promise<ContainerMetricsSnapshot> {
      signal?.throwIfAborted();
      const ids = requireDockerContainerIds(await engineReader.listContainers(signal));
      const identities = await mapWithConcurrency(
        ids,
        concurrency,
        async (id): Promise<{ id: string; identity: ContainerMetricsIdentity | null }> => {
          signal?.throwIfAborted();
          return {
            id,
            identity: readRunningIdentity(await engineReader.inspectContainer(id, signal), id),
          };
        },
      );

      signal?.throwIfAborted();
      const counts = new Map<string, number>();
      for (const candidate of identities) {
        if (candidate.identity === null) continue;
        const key = containerMetricsIdentityKey(candidate.identity);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }

      const uniqueIdentities = identities.filter(
        (candidate): candidate is { id: string; identity: ContainerMetricsIdentity } =>
          candidate.identity !== null &&
          counts.get(containerMetricsIdentityKey(candidate.identity)) === 1,
      );
      const candidates = await mapWithConcurrency(
        uniqueIdentities,
        concurrency,
        async (candidate): Promise<ContainerMetricsSample | null> => {
          signal?.throwIfAborted();
          const metrics = readMetrics(await engineReader.statsContainer(candidate.id, signal));
          return metrics === null ? null : { identity: candidate.identity, ...metrics };
        },
      );

      signal?.throwIfAborted();
      const observedAt = now();
      if (!Number.isFinite(observedAt.getTime())) throw new Error("invalid metrics observation time");

      return {
        schema: CONTAINER_METRICS_SNAPSHOT_SCHEMA,
        observedAt: observedAt.toISOString(),
        containers: candidates
          .filter((candidate): candidate is ContainerMetricsSample => candidate !== null)
          .sort(compareSamples),
      };
    },
  };
}
