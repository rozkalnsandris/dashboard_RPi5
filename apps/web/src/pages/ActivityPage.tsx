import { Activity, Box, Cloud, DatabaseBackup, GitCommitHorizontal } from "lucide-react";

const events = [
  { time: "14:12", category: "Docker", icon: Box, tone: "warning", message: "homeassistant restart observed", detail: "Fixture event · autoheal source" },
  { time: "14:00", category: "Backup", icon: DatabaseBackup, tone: "good", message: "nightly backup completed", detail: "Fixture evidence · duration 4m 12s" },
  { time: "13:31", category: "Deployment", icon: GitCommitHorizontal, tone: "good", message: "CV production SHA verified", detail: "Fixture evidence · no deploy action" },
  { time: "12:54", category: "Endpoint", icon: Cloud, tone: "info", message: "public endpoints remain reachable", detail: "Fixture availability projection" },
] as const;

export function ActivityPage() {
  return (
    <section className="page-stack" aria-labelledby="activity-page-title">
      <div className="page-heading">
        <p className="eyebrow">What changed</p>
        <h1 id="activity-page-title">Activity</h1>
        <p>A single human-readable timeline for Docker, services, backups, deployments and endpoint changes.</p>
      </div>

      <section className="panel activity-page-panel" aria-label="Fixture activity timeline">
        <div className="panel-heading">
          <div><p className="eyebrow">Today</p><h2>Recent events</h2></div>
          <Activity size={19} aria-hidden="true" />
        </div>
        <ol className="activity-timeline">
          {events.map(({ time, category, icon: Icon, tone, message, detail }) => (
            <li key={`${time}-${message}`}>
              <time>{time}</time>
              <span className={`timeline-icon timeline-icon--${tone}`}><Icon size={16} aria-hidden="true" /></span>
              <div>
                <div className="timeline-title"><strong>{message}</strong><span>{category}</span></div>
                <p>{detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
