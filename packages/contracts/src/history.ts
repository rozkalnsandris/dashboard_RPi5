import { Static, Type } from "@sinclair/typebox";

export const HistoryRangeSchema = Type.Union([
  Type.Literal("1h"),
  Type.Literal("24h"),
  Type.Literal("7d"),
]);

export type HistoryRange = Static<typeof HistoryRangeSchema>;

export const HostHistoryMetricSchema = Type.Union([
  Type.Literal("CPU_PERCENT"),
  Type.Literal("MEMORY_PERCENT"),
  Type.Literal("ROOT_FS_PERCENT"),
  Type.Literal("LOAD1"),
]);

export type HostHistoryMetric = Static<typeof HostHistoryMetricSchema>;

/**
 * Server-owned registry vocabulary prepared for richer native host history.
 * HostHistoryMetric remains the active public snapshot vocabulary until a later
 * activation phase explicitly expands the response contract.
 */
export type HostHistoryRegistryMetric =
  | HostHistoryMetric
  | "CPU_USER_PERCENT"
  | "CPU_SYSTEM_PERCENT"
  | "CPU_IOWAIT_PERCENT"
  | "SWAP_PERCENT"
  | "SOC_TEMP_CELSIUS"
  | "NVME_TEMP_CELSIUS"
  | "FAN_RPM"
  | "FAN_PWM_PERCENT"
  | "NETWORK_RX_BYTES_PER_SECOND"
  | "NETWORK_TX_BYTES_PER_SECOND"
  | "DISK_READ_BYTES_PER_SECOND"
  | "DISK_WRITE_BYTES_PER_SECOND"
  | "UPTIME_SECONDS";

export const HistorySeriesStateSchema = Type.Union([
  Type.Literal("AVAILABLE"),
  Type.Literal("UNAVAILABLE"),
]);

export type HistorySeriesState = Static<typeof HistorySeriesStateSchema>;

export const HistoryPointSchema = Type.Object(
  {
    timestamp: Type.String({ format: "date-time" }),
    value: Type.Number(),
  },
  { additionalProperties: false },
);

export type HistoryPoint = Static<typeof HistoryPointSchema>;

const AvailableHostHistorySeriesSchema = Type.Object(
  {
    metric: HostHistoryMetricSchema,
    state: Type.Literal("AVAILABLE"),
    points: Type.Array(HistoryPointSchema, { minItems: 1, maxItems: 337 }),
  },
  { additionalProperties: false },
);

const UnavailableHostHistorySeriesSchema = Type.Object(
  {
    metric: HostHistoryMetricSchema,
    state: Type.Literal("UNAVAILABLE"),
    points: Type.Array(HistoryPointSchema, { maxItems: 0 }),
  },
  { additionalProperties: false },
);

export const HostHistorySeriesSchema = Type.Union([
  AvailableHostHistorySeriesSchema,
  UnavailableHostHistorySeriesSchema,
]);

export type HostHistorySeries = Static<typeof HostHistorySeriesSchema>;

export const HostHistoryQuerySchema = Type.Object(
  {
    range: HistoryRangeSchema,
  },
  { additionalProperties: false },
);

export type HostHistoryQuery = Static<typeof HostHistoryQuerySchema>;

export const HostHistorySnapshotSchema = Type.Object(
  {
    observedAt: Type.String({ format: "date-time" }),
    range: HistoryRangeSchema,
    windowStart: Type.String({ format: "date-time" }),
    windowEnd: Type.String({ format: "date-time" }),
    series: Type.Array(HostHistorySeriesSchema, { minItems: 4, maxItems: 4 }),
    grafanaHref: Type.Union([
      Type.String({ minLength: 1, maxLength: 2048, format: "uri" }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export type HostHistorySnapshot = Static<typeof HostHistorySnapshotSchema>;

export const DashboardApiErrorCodeSchema = Type.Union([
  Type.Literal("INVALID_REQUEST"),
  Type.Literal("SOURCE_UNAVAILABLE"),
  Type.Literal("INTERNAL_ERROR"),
]);

export type DashboardApiErrorCode = Static<typeof DashboardApiErrorCodeSchema>;

export const DashboardApiErrorSchema = Type.Object(
  {
    error: DashboardApiErrorCodeSchema,
  },
  { additionalProperties: false },
);

export type DashboardApiError = Static<typeof DashboardApiErrorSchema>;
