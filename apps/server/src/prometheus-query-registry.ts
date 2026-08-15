import type { HostHistoryMetric } from "@dashboard-rpi5/contracts/history";

import { PrometheusSourceUnavailableError } from "./prometheus-types.js";

function validateNodeInstance(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new PrometheusSourceUnavailableError();
  }
  return value;
}

function escapePromqlLabelValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function selector(metric: string, matchers: readonly string[]): string {
  return matchers.length === 0 ? metric : `${metric}{${matchers.join(",")}}`;
}

export function buildHostPromqlRegistry(
  nodeInstance?: string,
): Readonly<Record<HostHistoryMetric, string>> {
  const validatedInstance = validateNodeInstance(nodeInstance);
  const instanceMatcher =
    validatedInstance === undefined
      ? undefined
      : `instance="${escapePromqlLabelValue(validatedInstance)}"`;
  const withInstance = (matchers: readonly string[]) =>
    instanceMatcher === undefined ? [...matchers] : [...matchers, instanceMatcher];

  const cpuIdle = selector("node_cpu_seconds_total", withInstance(['mode="idle"']));
  const memoryAvailable = selector("node_memory_MemAvailable_bytes", withInstance([]));
  const memoryTotal = selector("node_memory_MemTotal_bytes", withInstance([]));
  const rootAvailable = selector(
    "node_filesystem_avail_bytes",
    withInstance(['mountpoint="/"', 'fstype!="rootfs"']),
  );
  const rootTotal = selector(
    "node_filesystem_size_bytes",
    withInstance(['mountpoint="/"', 'fstype!="rootfs"']),
  );
  const loadOne = selector("node_load1", withInstance([]));

  return Object.freeze({
    CPU_PERCENT: `100 * (1 - avg(rate(${cpuIdle}[5m])))`,
    MEMORY_PERCENT: `100 * (1 - (avg(${memoryAvailable}) / avg(${memoryTotal})))`,
    ROOT_FS_PERCENT: `100 * (1 - (max(${rootAvailable}) / max(${rootTotal})))`,
    LOAD1: `avg(${loadOne})`,
  });
}
