import type {
  LogSourceDescriptor,
  LogSourceId,
} from "@dashboard-rpi5/contracts/logs";

export const PRIVILEGED_LOGS_ENV = "DASHBOARD_RPI5_PRIVILEGED_LOGS" as const;

export type PrivilegedLogSourceId = Exclude<
  LogSourceId,
  "docker:homeassistant" | "docker:prometheus"
>;

interface JournalOrigin {
  uid: string;
  transport: string;
  identifier: string;
}

export type PrivilegedLogSourceRegistration =
  | {
      descriptor: LogSourceDescriptor & { sourceId: PrivilegedLogSourceId };
      kind: "SYSTEMD";
      unitId: string;
    }
  | {
      descriptor: LogSourceDescriptor & { sourceId: PrivilegedLogSourceId };
      kind: "JOURNAL";
      matches: readonly string[];
      origin: JournalOrigin;
    }
  | {
      descriptor: LogSourceDescriptor & { sourceId: PrivilegedLogSourceId };
      kind: "FILE";
      path: string;
    };

export const PRIVILEGED_LOG_SOURCE_REGISTRY = Object.freeze<
  readonly PrivilegedLogSourceRegistration[]
>([
  { descriptor: { sourceId: "systemd:docker", label: "Docker Engine", kind: "SYSTEMD", rangeMode: "TIME" }, kind: "SYSTEMD", unitId: "docker.service" },
  { descriptor: { sourceId: "systemd:ssh", label: "SSH", kind: "SYSTEMD", rangeMode: "TIME" }, kind: "SYSTEMD", unitId: "ssh.service" },
  { descriptor: { sourceId: "systemd:cron", label: "Cron scheduler", kind: "SYSTEMD", rangeMode: "TIME" }, kind: "SYSTEMD", unitId: "cron.service" },
  { descriptor: { sourceId: "systemd:dashboard-rpi5-agent", label: "Dashboard agent", kind: "SYSTEMD", rangeMode: "TIME" }, kind: "SYSTEMD", unitId: "dashboard-rpi5-agent.service" },
  { descriptor: { sourceId: "systemd:rpi5-update", label: "RPi5 maintenance", kind: "SYSTEMD", rangeMode: "TIME" }, kind: "SYSTEMD", unitId: "rpi5-update.service" },
  { descriptor: { sourceId: "systemd:cloudflared", label: "Cloudflared", kind: "SYSTEMD", rangeMode: "TIME" }, kind: "SYSTEMD", unitId: "cloudflared.service" },
  { descriptor: { sourceId: "systemd:rpi5-monitor", label: "RPi5 monitor", kind: "SYSTEMD", rangeMode: "TIME" }, kind: "SYSTEMD", unitId: "rpi5-monitor.service" },
  { descriptor: { sourceId: "systemd:rpi5-post-reboot", label: "RPi5 post-reboot", kind: "SYSTEMD", rangeMode: "TIME" }, kind: "SYSTEMD", unitId: "rpi5-post-reboot.service" },
  { descriptor: { sourceId: "systemd:rpi5-tmp-headroom", label: "RPi5 tmp headroom", kind: "SYSTEMD", rangeMode: "TIME" }, kind: "SYSTEMD", unitId: "rpi5-tmp-headroom.service" },
  { descriptor: { sourceId: "systemd:rpi5-dashboard-evidence", label: "RPi5 dashboard evidence", kind: "SYSTEMD", rangeMode: "TIME" }, kind: "SYSTEMD", unitId: "rpi5-dashboard-evidence.service" },
  { descriptor: { sourceId: "systemd:hermes-tech-web", label: "Hermes Tech web", kind: "SYSTEMD", rangeMode: "TIME" }, kind: "SYSTEMD", unitId: "hermes-tech-web.service" },
  {
    descriptor: { sourceId: "journal:rpi5-deploy", label: "RPi5 deploy", kind: "JOURNAL", rangeMode: "TIME" },
    kind: "JOURNAL",
    matches: ["_UID=0", "_TRANSPORT=syslog", "SYSLOG_IDENTIFIER=rpi5-deploy"],
    origin: { uid: "0", transport: "syslog", identifier: "rpi5-deploy" },
  },
  { descriptor: { sourceId: "file:rpi5-backup", label: "RPi5 backup", kind: "FILE", rangeMode: "TAIL" }, kind: "FILE", path: "/var/log/rpi5-backup.log" },
]);

const privilegedIds = new Set<LogSourceId>(PRIVILEGED_LOG_SOURCE_REGISTRY.map((registration) => registration.descriptor.sourceId));

export const PRIVILEGED_LOG_SOURCE_IDS = Object.freeze<readonly PrivilegedLogSourceId[]>(
  PRIVILEGED_LOG_SOURCE_REGISTRY.map((registration) => registration.descriptor.sourceId),
);

export function privilegedLogSourcesEnabled(value: string | undefined = process.env[PRIVILEGED_LOGS_ENV]): boolean {
  return value === "enabled";
}

export function isPrivilegedLogSourceId(sourceId: LogSourceId): sourceId is PrivilegedLogSourceId {
  return privilegedIds.has(sourceId);
}

export function getPrivilegedLogSourceRegistration(sourceId: LogSourceId): PrivilegedLogSourceRegistration | null {
  return PRIVILEGED_LOG_SOURCE_REGISTRY.find((registration) => registration.descriptor.sourceId === sourceId) ?? null;
}

export function listPrivilegedLogSourceDescriptors(): LogSourceDescriptor[] {
  return PRIVILEGED_LOG_SOURCE_REGISTRY.map((registration) => ({ ...registration.descriptor }));
}
