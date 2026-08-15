import type { SystemdServiceSnapshot } from "@dashboard-rpi5/contracts/services";
import { describe, expect, it } from "vitest";

import { classifyService, formatServiceAge, serviceToneLabel } from "./services-ui";

const base: SystemdServiceSnapshot = {
  unitId: "docker.service",
  label: "Docker Engine",
  loadState: "LOADED",
  activeState: "ACTIVE",
  subState: "running",
  enablement: "ENABLED",
  restartCount: 0,
  stateAgeSeconds: 120,
};

describe("Phase 5A services UI helpers", () => {
  it("classifies active loaded evidence as healthy", () => {
    expect(classifyService(base)).toBe("healthy");
    expect(serviceToneLabel("healthy")).toBe("Healthy");
  });

  it("keeps failed, transition and missing evidence distinct", () => {
    expect(classifyService({ ...base, activeState: "FAILED" })).toBe("critical");
    expect(classifyService({ ...base, activeState: "ACTIVATING" })).toBe("attention");
    expect(classifyService({ ...base, loadState: "NOT_FOUND", activeState: "INACTIVE" })).toBe("unknown");
    expect(classifyService({ ...base, activeState: "UNKNOWN" })).toBe("unknown");
  });

  it("formats bounded relative state age without pretending unknown is zero", () => {
    expect(formatServiceAge(null)).toBe("Unknown");
    expect(formatServiceAge(59.9)).toBe("59s");
    expect(formatServiceAge(120)).toBe("2m");
    expect(formatServiceAge(7_200)).toBe("2h");
    expect(formatServiceAge(172_800)).toBe("2d");
  });
});
