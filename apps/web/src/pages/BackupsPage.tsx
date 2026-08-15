import type { BackupEvidenceRun } from "@dashboard-rpi5/contracts/backups";
import type { BackupStatusSnapshot } from "@dashboard-rpi5/contracts/backup-status";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  CalendarClock,
  CircleCheck,
  Clock3,
  DatabaseBackup,
  HardDrive,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

import { fetchBackupStatus } from "../backup-api";

const BACKUP_REFRESH_MS = 30_000;

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAge(seconds: number | null): string {
  if (seconds === null) return "Unknown";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 48) return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours === 0 ? `${days}d` : `${days}d ${remainingHours}h`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "Unavailable";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function healthReason(snapshot: BackupStatusSnapshot): string {
  if (snapshot.health === "HEALTHY") {
    return "Latest completed backup succeeded and the last successful run is within the freshness budget.";
  }
  if (snapshot.latestRun?.result === "FAILED") {
    return "The latest completed backup failed. Review the backup log before relying on the next scheduled run.";
  }
  if (snapshot.freshness === "STALE") {
    return `The last successful backup is older than the ${snapshot.policy.freshnessBudgetHours}-hour freshness budget.`;
  }
  return "No completed backup run is available in the structured evidence window.";
}

function healthLabel(snapshot: BackupStatusSnapshot): string {
  if (snapshot.health === "HEALTHY") return "Healthy";
  if (snapshot.health === "ATTENTION") return "Needs attention";
  return "Unknown";
}

function freshnessLabel(snapshot: BackupStatusSnapshot): string {
  if (snapshot.freshness === "FRESH") return "Fresh";
  if (snapshot.freshness === "STALE") return "Stale";
  return "Unknown";
}

function RunRow({ run }: { run: BackupEvidenceRun }) {
  return (
    <li className="backup-run-row" data-result={run.result}>
      <div className="backup-run-row__result">
        <span className="backup-result-dot" aria-hidden="true" />
        <strong>{run.result === "SUCCESS" ? "Succeeded" : "Failed"}</strong>
      </div>
      <dl>
        <div><dt>Completed</dt><dd>{formatTimestamp(run.completedAt)}</dd></div>
        <div><dt>Duration</dt><dd>{formatDuration(run.durationSeconds)}</dd></div>
        <div><dt>Size</dt><dd>{formatBytes(run.sizeBytes)}</dd></div>
        <div><dt>Exit</dt><dd>{run.exitCode}</dd></div>
      </dl>
    </li>
  );
}

export function BackupsPage() {
  const backupQuery = useQuery({
    queryKey: ["backup-status"],
    queryFn: ({ signal }) => fetchBackupStatus(signal),
    staleTime: 0,
    refetchInterval: BACKUP_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  const snapshot = backupQuery.data;
  const sourceFailure = backupQuery.isError && snapshot === undefined;

  return (
    <section className="page-stack backups-page" aria-labelledby="backups-page-title">
      <div className="page-heading page-heading--compact">
        <p className="eyebrow">Recovery evidence</p>
        <h1 id="backups-page-title">Backups</h1>
        <p>Read-only health derived from structured backup results. Schedule and retention labels are reviewed policy metadata; secrets, archive paths and remote configuration are never returned to the browser.</p>
      </div>

      {backupQuery.isPending && !sourceFailure ? (
        <div className="logs-message" role="status">
          <RefreshCw size={18} aria-hidden="true" />
          <div><strong>Loading backup evidence…</strong><span>Waiting for the bounded local-agent source.</span></div>
        </div>
      ) : null}

      {sourceFailure ? (
        <div className="logs-message logs-message--warning" role="status">
          <ShieldAlert size={18} aria-hidden="true" />
          <div><strong>Backup evidence unavailable</strong><span>Backup state is unknown. Missing evidence is not treated as a successful backup.</span></div>
        </div>
      ) : null}

      {snapshot !== undefined ? (
        <>
          <section className="backup-health-card" data-health={snapshot.health} aria-labelledby="backup-health-title">
            <div className="backup-health-card__icon" aria-hidden="true">
              {snapshot.health === "HEALTHY" ? <CircleCheck size={22} /> : <ShieldAlert size={22} />}
            </div>
            <div>
              <p className="eyebrow">Current backup state</p>
              <h2 id="backup-health-title">{healthLabel(snapshot)}</h2>
              <p>{healthReason(snapshot)}</p>
            </div>
            <div className="backup-health-card__badges">
              <span className="backup-state-pill" data-health={snapshot.health}>{healthLabel(snapshot)}</span>
              <span className="backup-state-pill" data-freshness={snapshot.freshness}>{freshnessLabel(snapshot)}</span>
            </div>
          </section>

          <section className="backup-summary-grid" aria-label="Backup summary">
            <article className="backup-summary-card">
              <Clock3 size={18} aria-hidden="true" />
              <span>Last successful age</span>
              <strong>{formatAge(snapshot.ageSeconds)}</strong>
              <small>{snapshot.lastSuccessfulAt === null ? "No success in evidence" : formatTimestamp(snapshot.lastSuccessfulAt)}</small>
            </article>
            <article className="backup-summary-card">
              <DatabaseBackup size={18} aria-hidden="true" />
              <span>Latest result</span>
              <strong>{snapshot.latestRun === null ? "Unknown" : snapshot.latestRun.result === "SUCCESS" ? "Succeeded" : "Failed"}</strong>
              <small>{snapshot.latestRun === null ? "No completed run" : `${formatDuration(snapshot.latestRun.durationSeconds)} · ${formatBytes(snapshot.latestRun.sizeBytes)}`}</small>
            </article>
            <article className="backup-summary-card">
              <HardDrive size={18} aria-hidden="true" />
              <span>Destination</span>
              <strong>{snapshot.policy.destinationLabel}</strong>
              <small>Encrypted remote copy</small>
            </article>
            <article className="backup-summary-card">
              <CalendarClock size={18} aria-hidden="true" />
              <span>Schedule</span>
              <strong>{snapshot.policy.scheduleLabel}</strong>
              <small>{snapshot.policy.freshnessBudgetHours}h dashboard freshness budget</small>
            </article>
          </section>

          <section className="panel backup-policy-panel" aria-labelledby="backup-policy-title">
            <div className="panel-heading">
              <div><p className="eyebrow">Reviewed policy</p><h2 id="backup-policy-title">Retention</h2></div>
              <Archive size={19} aria-hidden="true" />
            </div>
            <dl className="backup-policy-list">
              <div><dt>Local retention</dt><dd>{snapshot.policy.localRetentionDays} days</dd></div>
              <div><dt>Remote retention</dt><dd>{snapshot.policy.remoteRetentionDays} days</dd></div>
              <div><dt>Freshness threshold</dt><dd>{snapshot.policy.freshnessBudgetHours} hours</dd></div>
            </dl>
          </section>

          <section className="panel backup-history-panel" aria-labelledby="backup-history-title">
            <div className="panel-heading">
              <div><p className="eyebrow">Bounded evidence</p><h2 id="backup-history-title">Recent runs</h2></div>
              <span className="count-pill">{snapshot.history.length}</span>
            </div>
            {snapshot.history.length === 0 ? (
              <p className="empty-state">No completed backup runs are present in the structured evidence window.</p>
            ) : (
              <ol className="backup-run-list">
                {snapshot.history.map((run) => <RunRow key={run.runId} run={run} />)}
              </ol>
            )}
          </section>

          <p className="backup-observed-at">Observed {formatTimestamp(snapshot.observedAt)} · visible refresh every 30 seconds</p>
        </>
      ) : null}
    </section>
  );
}
