import type {
  DockerEventAction,
  DockerRecentEvent,
  DockerRecentEventsSnapshot,
} from "@dashboard-rpi5/contracts";
import type {
  ActivityEventKind,
  ActivityItem,
  ActivitySeverity,
  ActivitySnapshot,
  ActivitySource,
  ActivitySourceState,
} from "@dashboard-rpi5/contracts/activity";
import type {
  BackupEvidenceRun,
  BackupEvidenceSnapshot,
} from "@dashboard-rpi5/contracts/backups";
import type {
  SystemdServiceSnapshot,
  SystemdServicesSnapshot,
} from "@dashboard-rpi5/contracts/services";
import { createHash } from "node:crypto";

import type { BackupEvidenceReader } from "./agent-backup-evidence-client.js";
import type { DockerEventsReader } from "./agent-docker-events-client.js";
import type { ServicesReader } from "./agent-services-client.js";

export const ACTIVITY_MAX_ITEMS = 256;
export const DOCKER_BURST_WINDOW_MS = 5_000;

export type ActivityReader = () => Promise<ActivitySnapshot>;

interface ActivityDependencies {
  dockerEventsReader: DockerEventsReader;
  servicesReader: ServicesReader;
  backupEvidenceReader: BackupEvidenceReader;
  now?: () => Date;
}

export class ActivitySourceUnavailableError extends Error {
  constructor() {
    super("Activity sources unavailable");
    this.name = "ActivitySourceUnavailableError";
  }
}

function clampText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(1, maxLength - 1))}…`;
}

function dockerSeverity(event: DockerRecentEvent): ActivitySeverity {
  if (event.action === "OOM") return "CRITICAL";
  if (event.action === "HEALTH_STATUS") {
    if (event.health === "UNHEALTHY") return "CRITICAL";
    if (event.health === "HEALTHY") return "INFO";
    return "ATTENTION";
  }
  if (event.action === "DIE") {
    return event.exitCode !== null && event.exitCode !== 0 ? "CRITICAL" : "ATTENTION";
  }
  if (
    event.action === "RESTART" ||
    event.action === "KILL" ||
    event.action === "STOP" ||
    event.action === "PAUSE" ||
    event.action === "DESTROY"
  ) {
    return "ATTENTION";
  }
  return "INFO";
}

const DOCKER_ACTION_LABEL: Record<DockerEventAction, string> = {
  CREATE: "created",
  DESTROY: "destroyed",
  DIE: "exited",
  HEALTH_STATUS: "health changed",
  KILL: "killed",
  OOM: "out of memory",
  PAUSE: "paused",
  RENAME: "renamed",
  RESTART: "restarted",
  START: "started",
  STOP: "stopped",
  UNPAUSE: "unpaused",
  UPDATE: "updated",
};

function dockerDetail(event: DockerRecentEvent): string {
  const evidence: string[] = [];
  if (event.health !== null) evidence.push(`health ${event.health.toLowerCase()}`);
  if (event.exitCode !== null) evidence.push(`exit ${event.exitCode}`);
  if (event.signal !== null) evidence.push(`signal ${event.signal}`);
  if (event.image !== null) evidence.push(`image ${event.image}`);
  evidence.push(`scope ${event.scope.toLowerCase()}`);
  return clampText(evidence.join(" · "), 320);
}

function dockerEventId(event: DockerRecentEvent): string {
  const digest = createHash("sha256").update(JSON.stringify(event)).digest("hex");
  return `docker:${digest}`;
}

function mapDockerEvent(event: DockerRecentEvent): ActivityItem {
  const subject = clampText(event.containerName ?? event.containerId.slice(0, 12), 96);
  return {
    id: dockerEventId(event),
    source: "DOCKER",
    severity: dockerSeverity(event),
    kind: `DOCKER_${event.action}` as ActivityEventKind,
    occurredAt: event.occurredAt,
    title: clampText(`${subject} ${DOCKER_ACTION_LABEL[event.action]}`, 160),
    detail: dockerDetail(event),
    target: "/docker",
    groupCount: 1,
  };
}

function dockerGroupKey(event: DockerRecentEvent): string {
  return [
    event.containerId,
    event.action,
    event.containerName ?? "none",
    event.image ?? "none",
    event.health ?? "none",
    event.exitCode ?? "none",
    event.signal ?? "none",
    event.scope,
  ].join("\u0000");
}

export function normalizeDockerActivity(snapshot: DockerRecentEventsSnapshot): ActivityItem[] {
  const sorted = [...snapshot.events].sort(
    (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
  );
  const exactSeen = new Set<string>();
  const groups = new Map<string, ActivityItem>();
  const output: ActivityItem[] = [];

  for (const event of sorted) {
    const mapped = mapDockerEvent(event);
    if (exactSeen.has(mapped.id)) continue;
    exactSeen.add(mapped.id);

    const groupKey = dockerGroupKey(event);
    const previous = groups.get(groupKey);
    if (
      previous !== undefined &&
      Date.parse(previous.occurredAt) - Date.parse(mapped.occurredAt) <= DOCKER_BURST_WINDOW_MS
    ) {
      previous.groupCount = Math.min(ACTIVITY_MAX_ITEMS, previous.groupCount + 1);
      continue;
    }

    groups.set(groupKey, mapped);
    output.push(mapped);
  }

  return output;
}

function systemdSeverity(service: SystemdServiceSnapshot): ActivitySeverity {
  if (service.activeState === "FAILED") return "CRITICAL";
  if (service.loadState !== "LOADED" || service.activeState !== "ACTIVE") {
    return "ATTENTION";
  }
  return "INFO";
}

function systemdOccurredAt(snapshot: SystemdServicesSnapshot, service: SystemdServiceSnapshot): string | null {
  if (service.stateAgeSeconds === null) return null;
  const observedMs = Date.parse(snapshot.observedAt);
  const occurredMs = observedMs - service.stateAgeSeconds * 1_000;
  if (!Number.isFinite(occurredMs) || occurredMs > observedMs) return null;
  return new Date(occurredMs).toISOString();
}

export function normalizeSystemdActivity(snapshot: SystemdServicesSnapshot): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const service of snapshot.services) {
    const occurredAt = systemdOccurredAt(snapshot, service);
    if (occurredAt === null) continue;
    const state = service.activeState.toLowerCase();
    const details = [
      `load ${service.loadState.toLowerCase()}`,
      `state ${state}${service.subState === null ? "" : `/${service.subState}`}`,
      `enablement ${service.enablement.toLowerCase()}`,
      service.restartCount === null ? null : `restarts ${service.restartCount}`,
    ].filter((part): part is string => part !== null);

    items.push({
      id: `systemd:${service.unitId}:${occurredAt}:${service.activeState}:${service.subState ?? "none"}`,
      source: "SYSTEMD",
      severity: systemdSeverity(service),
      kind: "SYSTEMD_STATE",
      occurredAt,
      title: clampText(`${service.label} is ${state}`, 160),
      detail: clampText(details.join(" · "), 320),
      target: "/services",
      groupCount: 1,
    });
  }
  return items;
}

function backupEventId(run: BackupEvidenceRun): string {
  const digest = createHash("sha256").update(JSON.stringify(run)).digest("hex");
  return `backup:${digest}`;
}

export function normalizeBackupActivity(snapshot: BackupEvidenceSnapshot): ActivityItem[] {
  return snapshot.runs.map((run) => ({
    id: backupEventId(run),
    source: "BACKUP",
    severity: run.result === "SUCCESS" ? "INFO" : "CRITICAL",
    kind: "BACKUP_RESULT",
    occurredAt: run.completedAt,
    title: run.result === "SUCCESS" ? "Backup completed" : "Backup failed",
    detail: clampText(
      [
        `run ${run.runId}`,
        `duration ${run.durationSeconds}s`,
        run.sizeBytes === null ? "size unavailable" : `size ${run.sizeBytes} bytes`,
        `exit ${run.exitCode}`,
      ].join(" · "),
      320,
    ),
    target: "/backups",
    groupCount: 1,
  }));
}

function availableSource(source: ActivitySource, observedAt: string): ActivitySourceState {
  return { source, status: "AVAILABLE", observedAt };
}

function unavailableSource(source: ActivitySource): ActivitySourceState {
  return { source, status: "UNAVAILABLE", observedAt: null };
}

export function createActivityReader(dependencies: ActivityDependencies): ActivityReader {
  const now = dependencies.now ?? (() => new Date());
  return async () => {
    const [dockerResult, servicesResult, backupResult] = await Promise.allSettled([
      dependencies.dockerEventsReader(),
      dependencies.servicesReader(),
      dependencies.backupEvidenceReader(),
    ]);

    if (
      dockerResult.status === "rejected" &&
      servicesResult.status === "rejected" &&
      backupResult.status === "rejected"
    ) {
      throw new ActivitySourceUnavailableError();
    }

    const sources: ActivitySourceState[] = [
      dockerResult.status === "fulfilled"
        ? availableSource("DOCKER", dockerResult.value.observedAt)
        : unavailableSource("DOCKER"),
      servicesResult.status === "fulfilled"
        ? availableSource("SYSTEMD", servicesResult.value.observedAt)
        : unavailableSource("SYSTEMD"),
      backupResult.status === "fulfilled"
        ? availableSource("BACKUP", backupResult.value.observedAt)
        : unavailableSource("BACKUP"),
    ];

    const items = [
      ...(dockerResult.status === "fulfilled" ? normalizeDockerActivity(dockerResult.value) : []),
      ...(servicesResult.status === "fulfilled" ? normalizeSystemdActivity(servicesResult.value) : []),
      ...(backupResult.status === "fulfilled" ? normalizeBackupActivity(backupResult.value) : []),
    ];

    const uniqueItems = [...new Map(items.map((item) => [item.id, item])).values()]
      .sort((left, right) => {
        const byTime = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
        return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
      })
      .slice(0, ACTIVITY_MAX_ITEMS);

    return {
      observedAt: now().toISOString(),
      sources,
      items: uniqueItems,
    };
  };
}
