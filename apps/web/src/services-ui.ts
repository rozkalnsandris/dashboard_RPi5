import type { SystemdServiceSnapshot } from "@dashboard-rpi5/contracts/services";

export type ServiceTone = "healthy" | "attention" | "critical" | "unknown";

export function classifyService(service: SystemdServiceSnapshot): ServiceTone {
  if (
    service.activeState === "FAILED" ||
    service.loadState === "BAD_SETTING" ||
    service.loadState === "ERROR"
  ) {
    return "critical";
  }

  if (
    service.loadState === "NOT_FOUND" ||
    service.loadState === "UNKNOWN" ||
    service.activeState === "UNKNOWN"
  ) {
    return "unknown";
  }

  if (
    service.activeState === "ACTIVE" &&
    service.loadState === "LOADED" &&
    service.enablement !== "MASKED" &&
    service.enablement !== "MASKED_RUNTIME"
  ) {
    return "healthy";
  }

  return "attention";
}

export function serviceToneLabel(tone: ServiceTone): string {
  switch (tone) {
    case "healthy":
      return "Healthy";
    case "attention":
      return "Attention";
    case "critical":
      return "Critical";
    case "unknown":
      return "Unknown";
  }
}

export function formatServiceAge(seconds: number | null): string {
  if (seconds === null) return "Unknown";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
