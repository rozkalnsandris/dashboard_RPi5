import type { HostHistoryRegistryMetric } from "@dashboard-rpi5/contracts/history";

import { PrometheusSourceUnavailableError } from "./prometheus-types.js";

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
}

function validateNodeInstance(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length === 0 || value.length > 256 || containsControlCharacter(value)) {
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
): Readonly<Record<HostHistoryRegistryMetric, string>> {
  const validatedInstance = validateNodeInstance(nodeInstance);
  const instanceMatcher =
    validatedInstance === undefined
      ? undefined
      : `instance="${escapePromqlLabelValue(validatedInstance)}"`;
  const withInstance = (matchers: readonly string[]) =>
    instanceMatcher === undefined ? [...matchers] : [...matchers, instanceMatcher];

  const cpuMode = (mode: string) =>
    selector("node_cpu_seconds_total", withInstance([`mode="${mode}"`]));
  const memoryAvailable = selector("node_memory_MemAvailable_bytes", withInstance([]));
  const memoryTotal = selector("node_memory_MemTotal_bytes", withInstance([]));
  const swapFree = selector("node_memory_SwapFree_bytes", withInstance([]));
  const swapTotal = selector("node_memory_SwapTotal_bytes", withInstance([]));
  const rootAvailable = selector(
    "node_filesystem_avail_bytes",
    withInstance(['mountpoint="/"', 'fstype!="rootfs"']),
  );
  const rootTotal = selector(
    "node_filesystem_size_bytes",
    withInstance(['mountpoint="/"', 'fstype!="rootfs"']),
  );
  const loadOne = selector("node_load1", withInstance([]));
  const socTemperature = selector(
    "node_thermal_zone_temp",
    withInstance(['type="cpu-thermal"']),
  );
  const nvmeTemperature = selector(
    "node_hwmon_temp_celsius",
    withInstance(['chip=~"nvme_.*"']),
  );
  const fanRpm = selector(
    "node_hwmon_fan_rpm",
    withInstance(['chip="platform_cooling_fan"', 'sensor="fan1"']),
  );
  const coolingState = selector(
    "node_cooling_device_cur_state",
    withInstance(['type="pwm-fan"']),
  );
  const coolingMaxState = selector(
    "node_cooling_device_max_state",
    withInstance(['type="pwm-fan"']),
  );
  const networkReceive = selector(
    "node_network_receive_bytes_total",
    withInstance(['device!="lo"']),
  );
  const networkTransmit = selector(
    "node_network_transmit_bytes_total",
    withInstance(['device!="lo"']),
  );
  const physicalDiskMatcher =
    'device=~"^(nvme[0-9]+n[0-9]+|sd[a-z]+|vd[a-z]+|xvd[a-z]+|mmcblk[0-9]+)$"';
  const diskRead = selector("node_disk_read_bytes_total", withInstance([physicalDiskMatcher]));
  const diskWritten = selector(
    "node_disk_written_bytes_total",
    withInstance([physicalDiskMatcher]),
  );
  const bootTime = selector("node_boot_time_seconds", withInstance([]));

  return Object.freeze({
    CPU_PERCENT: `100 * (1 - avg(rate(${cpuMode("idle")}[5m])))`,
    CPU_USER_PERCENT: `100 * avg(rate(${cpuMode("user")}[5m]))`,
    CPU_SYSTEM_PERCENT: `100 * avg(rate(${cpuMode("system")}[5m]))`,
    CPU_IOWAIT_PERCENT: `100 * avg(rate(${cpuMode("iowait")}[5m]))`,
    MEMORY_PERCENT: `100 * (1 - (avg(${memoryAvailable}) / avg(${memoryTotal})))`,
    SWAP_PERCENT: `100 * (1 - (avg(${swapFree}) / avg(${swapTotal})))`,
    ROOT_FS_PERCENT: `100 * (1 - (max(${rootAvailable}) / max(${rootTotal})))`,
    LOAD1: `avg(${loadOne})`,
    SOC_TEMP_CELSIUS: `max(${socTemperature})`,
    NVME_TEMP_CELSIUS: `max(${nvmeTemperature})`,
    FAN_RPM: `max(${fanRpm})`,
    FAN_PWM_PERCENT: `100 * (max(${coolingState}) / max(${coolingMaxState}))`,
    NETWORK_RX_BYTES_PER_SECOND: `sum(rate(${networkReceive}[5m]))`,
    NETWORK_TX_BYTES_PER_SECOND: `sum(rate(${networkTransmit}[5m]))`,
    DISK_READ_BYTES_PER_SECOND: `sum(rate(${diskRead}[5m]))`,
    DISK_WRITE_BYTES_PER_SECOND: `sum(rate(${diskWritten}[5m]))`,
    UPTIME_SECONDS: `time() - max(${bootTime})`,
  });
}
