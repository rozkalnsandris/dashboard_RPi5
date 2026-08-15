import type { ContainerFixture } from "@dashboard-rpi5/contracts";

export const systemFixture = {
  observedAt: "2026-08-15T12:44:00.000Z",
  state: "HEALTHY" as const,
  uptime: "37d 14h",
  temperatureC: 43,
  throttle: "None",
  cpuPercent: 12,
  memoryUsedGiB: 3,
  memoryTotalGiB: 8,
  diskPercent: 41,
  runningContainers: 16,
  expectedContainers: 16,
};

export const containerFixtures: ContainerFixture[] = [
  {
    id: "homeassistant",
    name: "homeassistant",
    state: "RUNNING",
    health: "HEALTHY",
    cpuPercent: 6.8,
    memoryMiB: 624,
    networkRxMiB: 74,
    networkTxMiB: 18,
    uptime: "12d 4h",
  },
  {
    id: "prometheus",
    name: "prometheus",
    state: "RUNNING",
    health: "HEALTHY",
    cpuPercent: 3.2,
    memoryMiB: 418,
    networkRxMiB: 12,
    networkTxMiB: 4,
    uptime: "21d 7h",
  },
  {
    id: "grafana",
    name: "grafana",
    state: "RUNNING",
    health: "HEALTHY",
    cpuPercent: 1.7,
    memoryMiB: 286,
    networkRxMiB: 8,
    networkTxMiB: 5,
    uptime: "21d 7h",
  },
];

export const activityFixture = [
  { time: "02:12", tone: "warning", label: "homeassistant restarted by autoheal" },
  { time: "02:00", tone: "good", label: "nightly backup completed" },
  { time: "00:31", tone: "good", label: "CV deployment verification passed" },
];
