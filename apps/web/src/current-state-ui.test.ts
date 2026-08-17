import { describe, expect, it } from "vitest";

import {
  containerNeedsAttention,
  containerStatusLabel,
  formatBytes,
  formatPercent,
  formatUptime,
  throttleSummary,
} from "./current-state-ui";

const host = {
  throttle: {
    current: { underVoltage: false, armFrequencyCapped: false, throttled: false, softTemperatureLimit: false },
  },
} as Parameters<typeof throttleSummary>[0];

const container = {
  state: "RUNNING",
  health: "HEALTHY",
  statsState: "AVAILABLE",
} as Parameters<typeof containerStatusLabel>[0];

describe("current-state UI helpers", () => {
  it("formats bounded telemetry without manufacturing unavailable values", () => {
    expect(formatBytes(null)).toBe("Unavailable");
    expect(formatBytes(1_073_741_824)).toBe("1.0 GiB");
    expect(formatPercent(null)).toBe("Unavailable");
    expect(formatPercent(12.4)).toBe("12%");
    expect(formatUptime(null)).toBe("Unavailable");
    expect(formatUptime(90_000)).toBe("1d 1h");
  });

  it("classifies available throttle and Docker attention from real state", () => {
    expect(throttleSummary(host)).toEqual({
      label: "None",
      detail: "No current power flags",
      active: false,
      available: true,
    });
    expect(containerStatusLabel(container)).toBe("healthy");
    expect(containerNeedsAttention(container)).toBe(false);
    expect(containerNeedsAttention({ ...container, state: "EXITED" })).toBe(true);
  });

  it("shows unavailable throttle evidence without inventing a healthy state", () => {
    expect(
      throttleSummary({ throttle: { state: "UNAVAILABLE" } } as Parameters<typeof throttleSummary>[0]),
    ).toEqual({
      label: "Unavailable",
      detail: "Firmware throttle evidence unavailable",
      active: false,
      available: false,
    });
  });
});
