import {
  parseBackupStatusSnapshot,
  type BackupStatusSnapshot,
} from "@dashboard-rpi5/contracts/backup-status";

export async function fetchBackupStatus(signal?: AbortSignal): Promise<BackupStatusSnapshot> {
  const response = await fetch("/api/backups", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error("Backup status unavailable");
  return parseBackupStatusSnapshot(await response.json());
}
