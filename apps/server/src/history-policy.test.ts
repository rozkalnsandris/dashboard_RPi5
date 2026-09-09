import { describe, expect, it } from "vitest";

import { HISTORY_RANGE_POLICY, HOST_HISTORY_METRICS } from "./history-policy.js";
import { buildHostPromqlRegistry } from "./prometheus-query-registry.js";

const REGISTRY_METRICS = [
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
] as const;

describe("history range policy", () => {
  it("keeps the three browser-selectable windows and active public metrics bounded", () => {
    expect(HISTORY_RANGE_POLICY).toEqual({
      "1h": { durationSeconds: 3_600, stepSeconds: 30, maxPoints: 121 },
      "24h": { durationSeconds: 86_400, stepSeconds: 300, maxPoints: 289 },
      "7d": { durationSeconds: 604_800, stepSeconds: 1_800, maxPoints: 337 },
    });
    expect(HOST_HISTORY_METRICS).toEqual([
      "CPU_PERCENT",
      "MEMORY_PERCENT",
      "ROOT_FS_PERCENT",
      "LOAD1",
    ]);
  });
});

describe("fixed PromQL registry", () => {
  it("owns the expanded host query vocabulary server-side", () => {
    const registry = buildHostPromqlRegistry();

    expect(Object.keys(registry)).toEqual(REGISTRY_METRICS);
    expect(registry.CPU_PERCENT).toContain('mode="idle"');
    expect(registry.CPU_USER_PERCENT).toContain('mode="user"');
    expect(registry.CPU_SYSTEM_PERCENT).toContain('mode="system"');
    expect(registry.CPU_IOWAIT_PERCENT).toContain('mode="iowait"');
    expect(registry.SWAP_PERCENT).toContain("node_memory_SwapTotal_bytes");
    expect(registry.SOC_TEMP_CELSIUS).toContain('type="cpu-thermal"');
    expect(registry.NVME_TEMP_CELSIUS).toContain('chip=~"nvme_.*"');
    expect(registry.FAN_RPM).toContain('chip="platform_cooling_fan"');
    expect(registry.FAN_PWM_PERCENT).toContain('type="pwm-fan"');
    expect(registry.NETWORK_RX_BYTES_PER_SECOND).toMatch(/^sum\(rate\(/);
    expect(registry.NETWORK_TX_BYTES_PER_SECOND).toContain('device!="lo"');
    expect(registry.DISK_READ_BYTES_PER_SECOND).toContain("nvme[0-9]+n[0-9]+");
    expect(registry.DISK_WRITE_BYTES_PER_SECOND).toMatch(/^sum\(rate\(/);
    expect(registry.UPTIME_SECONDS).toContain("node_boot_time_seconds");
  });

  it("keeps every expanded query deterministically aggregated to one result series", () => {
    const registry = buildHostPromqlRegistry();

    for (const query of Object.values(registry)) {
      expect(query).toMatch(/^(100 \* |avg\(|max\(|sum\(|time\(\) - max\()/);
    }
  });

  it("adds only a server-side instance matcher", () => {
    const registry = buildHostPromqlRegistry("rpi5:9100");

    for (const query of Object.values(registry)) {
      expect(query).toContain('instance="rpi5:9100"');
    }
    expect(registry.LOAD1).toBe('avg(node_load1{instance="rpi5:9100"})');
  });

  it("rejects control characters in the configured instance", () => {
    expect(() => buildHostPromqlRegistry("rpi5:9100\nother")).toThrow(
      "Prometheus source unavailable",
    );
  });
});
