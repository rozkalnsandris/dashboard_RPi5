import type { HistoryRange, HostHistoryMetric } from "@dashboard-rpi5/contracts/history";

export const HOST_HISTORY_METRICS = Object.freeze([
  "CPU_PERCENT",
  "MEMORY_PERCENT",
  "ROOT_FS_PERCENT",
  "LOAD1",
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
