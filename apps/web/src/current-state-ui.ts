import type {
  DockerContainerSnapshot,
  HostSummary,
} from "@dashboard-rpi5/contracts";

export function formatBytes(value: number | null): string {
  if (value === null) return "Unavailable";
  if (value < 1024) return `${value} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"] as const;
  let scaled = value / 1024;
  let index = 0;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[index]}`;
}

export function formatPercent(value: number | null): string {
  return value === null ? "Unavailable" : `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

export function formatUptime(seconds: number | null): string {
  if (seconds === null) return "Unavailable";
  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export interface ThrottleSummary {
  label: string;
  detail: string;
  active: boolean;
  available: boolean;
}

export function throttleSummary(host: HostSummary): ThrottleSummary {
  if (!("current" in host.throttle)) {
    return {
      label: "Unavailable",
      detail: "Firmware throttle evidence unavailable",
      active: false,
      available: false,
    };
  }

  const labels: string[] = [];
  if (host.throttle.current.underVoltage) labels.push("under-voltage");
  if (host.throttle.current.armFrequencyCapped) labels.push("frequency capped");
  if (host.throttle.current.throttled) labels.push("throttled");
  if (host.throttle.current.softTemperatureLimit) labels.push("temperature limit");
  return labels.length === 0
    ? { label: "None", detail: "No current power flags", active: false, available: true }
    : { label: "Active", detail: labels.join(", "), active: true, available: true };
}

export function containerStatusLabel(container: DockerContainerSnapshot): string {
  if (container.health !== "NONE") return container.health.toLowerCase().replaceAll("_", " ");
  return container.state.toLowerCase().replaceAll("_", " ");
}

export function containerNeedsAttention(container: DockerContainerSnapshot): boolean {
  return (
    container.state !== "RUNNING" ||
    container.health === "UNHEALTHY" ||
    container.health === "STARTING" ||
    container.health === "UNKNOWN" ||
    container.statsState === "UNAVAILABLE"
  );
}
