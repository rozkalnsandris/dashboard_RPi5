import type { HistoryRange, HostHistoryMetric } from "@dashboard-rpi5/contracts/history";

export const HOST_HISTORY_METRICS = Object.freeze([
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
] as const satisfies readonly HostHistoryMetric[]);

export interface HistoryRangePolicy {
  durationSeconds: number;
  stepSeconds: number;
  maxPoints: number;
}

export const HISTORY_RANGE_POLICY: Readonly<Record<HistoryRange, HistoryRangePolicy>> =
  Object.freeze({
    "1h": Object.freeze({ durationSeconds: 60 * 60, stepSeconds: 30, maxPoints: 121 }),
    "24h": Object.freeze({
      durationSeconds: 24 * 60 * 60,
      stepSeconds: 5 * 60,
      maxPoints: 289,
    }),
    "7d": Object.freeze({
      durationSeconds: 7 * 24 * 60 * 60,
      stepSeconds: 30 * 60,
      maxPoints: 337,
    }),
  });
