import { useQuery } from "@tanstack/react-query";
import { CircleCheck, DatabaseBackup, ShieldAlert } from "lucide-react";
import { Link } from "react-router";

import { fetchBackupStatus } from "../backup-api";

const BACKUP_REFRESH_MS = 30_000;

export function BackupOverviewStatus() {
  const backupQuery = useQuery({
    queryKey: ["backup-status"],
    queryFn: ({ signal }) => fetchBackupStatus(signal),
    staleTime: 0,
    refetchInterval: BACKUP_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  if (backupQuery.isPending) {
    return (
      <section className="backup-overview-card" data-health="UNKNOWN" aria-label="Backup health">
        <DatabaseBackup size={20} aria-hidden="true" />
        <div><strong>Backup evidence loading</strong><span>Current backup health is not known yet.</span></div>
        <Link to="/backups">Open backups</Link>
      </section>
    );
  }

  if (backupQuery.isError || backupQuery.data === undefined) {
    return (
      <section className="backup-overview-card" data-health="UNKNOWN" aria-label="Backup health">
        <ShieldAlert size={20} aria-hidden="true" />
        <div><strong>Backup evidence unknown</strong><span>The structured backup source is unavailable; this is not treated as all-clear.</span></div>
        <Link to="/backups">Open backups</Link>
      </section>
    );
  }

  const snapshot = backupQuery.data;
  if (snapshot.health === "ATTENTION") {
    const reason =
      snapshot.latestRun?.result === "FAILED"
        ? "Latest completed backup failed."
        : `Last successful backup is older than the ${snapshot.policy.freshnessBudgetHours}-hour freshness budget.`;
    return (
      <section className="backup-overview-card" data-health="ATTENTION" aria-label="Backup health">
        <ShieldAlert size={20} aria-hidden="true" />
        <div><strong>Backup needs attention</strong><span>{reason}</span></div>
        <Link to="/backups">Review backups</Link>
      </section>
    );
  }

  if (snapshot.health === "HEALTHY") {
    return (
      <section className="backup-overview-card" data-health="HEALTHY" aria-label="Backup health">
        <CircleCheck size={20} aria-hidden="true" />
        <div><strong>Backup fresh</strong><span>Latest completed backup succeeded within the freshness budget.</span></div>
        <Link to="/backups">Open backups</Link>
      </section>
    );
  }

  return (
    <section className="backup-overview-card" data-health="UNKNOWN" aria-label="Backup health">
      <ShieldAlert size={20} aria-hidden="true" />
      <div><strong>Backup evidence unknown</strong><span>No completed backup run is present in the structured evidence window.</span></div>
      <Link to="/backups">Open backups</Link>
    </section>
  );
}
