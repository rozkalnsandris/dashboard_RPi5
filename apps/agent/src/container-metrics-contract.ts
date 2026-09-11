export const CONTAINER_METRICS_SNAPSHOT_SCHEMA =
  "dashboard-rpi5.container-metrics-snapshot.v1" as const;
export const CONTAINER_METRICS_MAX_CONTAINERS = 512;
export const CONTAINER_METRICS_MAX_IDENTITY_BYTES = 128;
export const CONTAINER_METRICS_MAX_VALUE = 1e24;

const COMPOSE_COMPONENT_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,127}$/;
const COMPOSE_CONTAINER_NUMBER_PATTERN = /^[1-9][0-9]{0,9}$/;

export interface ContainerMetricsIdentity {
  composeProject: string;
  composeService: string;
  composeContainerNumber: string;
}

export interface ContainerMetricsSample {
  identity: ContainerMetricsIdentity;
  cpuUsageSeconds: number;
  memoryWorkingSetBytes: number;
  networkReceiveBytes: number;
  networkTransmitBytes: number;
  filesystemReadBytes: number;
  filesystemWriteBytes: number;
}

export interface ContainerMetricsSnapshot {
  schema: typeof CONTAINER_METRICS_SNAPSHOT_SCHEMA;
  observedAt: string;
  containers: ContainerMetricsSample[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): void {
  const keys = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new Error("invalid container metrics payload");
  }
}

function validIdentityComponent(value: string): boolean {
  return (
    Buffer.byteLength(value, "utf8") <= CONTAINER_METRICS_MAX_IDENTITY_BYTES &&
    COMPOSE_COMPONENT_PATTERN.test(value)
  );
}

export function normalizeContainerMetricsIdentity(
  composeProject: unknown,
  composeService: unknown,
  composeContainerNumber: unknown,
): ContainerMetricsIdentity | null {
  if (
    typeof composeProject !== "string" ||
    typeof composeService !== "string" ||
    typeof composeContainerNumber !== "string" ||
    !validIdentityComponent(composeProject) ||
    !validIdentityComponent(composeService) ||
    Buffer.byteLength(composeContainerNumber, "utf8") > 10 ||
    !COMPOSE_CONTAINER_NUMBER_PATTERN.test(composeContainerNumber)
  ) {
    return null;
  }

  return {
    composeProject,
    composeService,
    composeContainerNumber,
  };
}

export function containerMetricsIdentityKey(identity: ContainerMetricsIdentity): string {
  return `${identity.composeProject}\0${identity.composeService}\0${identity.composeContainerNumber}`;
}

function requireMetricValue(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > CONTAINER_METRICS_MAX_VALUE
  ) {
    throw new Error("invalid container metrics payload");
  }
  return Object.is(value, -0) ? 0 : value;
}

function parseIdentity(value: unknown): ContainerMetricsIdentity {
  if (!isRecord(value)) throw new Error("invalid container metrics payload");
  requireExactKeys(value, ["composeProject", "composeService", "composeContainerNumber"]);
  const identity = normalizeContainerMetricsIdentity(
    value.composeProject,
    value.composeService,
    value.composeContainerNumber,
  );
  if (identity === null) throw new Error("invalid container metrics payload");
  return identity;
}

function parseSample(value: unknown): ContainerMetricsSample {
  if (!isRecord(value)) throw new Error("invalid container metrics payload");
  requireExactKeys(value, [
    "identity",
    "cpuUsageSeconds",
    "memoryWorkingSetBytes",
    "networkReceiveBytes",
    "networkTransmitBytes",
    "filesystemReadBytes",
    "filesystemWriteBytes",
  ]);

  return {
    identity: parseIdentity(value.identity),
    cpuUsageSeconds: requireMetricValue(value.cpuUsageSeconds),
    memoryWorkingSetBytes: requireMetricValue(value.memoryWorkingSetBytes),
    networkReceiveBytes: requireMetricValue(value.networkReceiveBytes),
    networkTransmitBytes: requireMetricValue(value.networkTransmitBytes),
    filesystemReadBytes: requireMetricValue(value.filesystemReadBytes),
    filesystemWriteBytes: requireMetricValue(value.filesystemWriteBytes),
  };
}

export function parseContainerMetricsSnapshot(value: unknown): ContainerMetricsSnapshot {
  if (!isRecord(value)) throw new Error("invalid container metrics payload");
  requireExactKeys(value, ["schema", "observedAt", "containers"]);
  if (value.schema !== CONTAINER_METRICS_SNAPSHOT_SCHEMA || typeof value.observedAt !== "string") {
    throw new Error("invalid container metrics payload");
  }

  const observedAt = new Date(value.observedAt);
  if (!Number.isFinite(observedAt.getTime()) || observedAt.toISOString() !== value.observedAt) {
    throw new Error("invalid container metrics payload");
  }
  if (
    !Array.isArray(value.containers) ||
    value.containers.length > CONTAINER_METRICS_MAX_CONTAINERS
  ) {
    throw new Error("invalid container metrics payload");
  }

  const containers = value.containers.map(parseSample);
  const identities = new Set<string>();
  for (const container of containers) {
    const key = containerMetricsIdentityKey(container.identity);
    if (identities.has(key)) throw new Error("duplicate container metrics identity");
    identities.add(key);
  }

  return {
    schema: CONTAINER_METRICS_SNAPSHOT_SCHEMA,
    observedAt: observedAt.toISOString(),
    containers,
  };
}
