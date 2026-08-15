import { AlertTriangle, CircleHelp, CloudOff, LoaderCircle, Settings } from "lucide-react";

const states = [
  {
    id: "loading",
    label: "Loading",
    tone: "info",
    icon: LoaderCircle,
    title: "Checking current evidence",
    description: "Keep the previous layout stable while the first trusted observation is loading.",
    value: "Checking…",
  },
  {
    id: "stale",
    label: "Stale",
    tone: "warning",
    icon: AlertTriangle,
    title: "Last observation is old",
    description: "Show the last known value with its age. Never silently present stale data as live.",
    value: "Last seen 4m ago",
  },
  {
    id: "error",
    label: "Unavailable",
    tone: "danger",
    icon: CloudOff,
    title: "Evidence source unavailable",
    description: "A failed read is an operational state, not a zero. Keep the error concise and actionable.",
    value: "Unavailable",
  },
  {
    id: "unknown",
    label: "Unknown",
    tone: "neutral",
    icon: CircleHelp,
    title: "No trustworthy evidence",
    description: "If required evidence is missing or cannot be represented, health must fail closed to Unknown.",
    value: "Unknown",
  },
] as const;

export function ReliabilityStatesPage() {
  return (
    <section className="page-stack" aria-labelledby="settings-title">
      <div className="page-heading">
        <p className="eyebrow">Phase 1 reliability contract</p>
        <h1 id="settings-title">Settings</h1>
        <p>Fixture state gallery for the loading, stale, unavailable and unknown states that every later live metric must support.</p>
      </div>

      <section className="panel" aria-labelledby="state-gallery-title">
        <div className="panel-heading">
          <div><p className="eyebrow">Fail closed visually</p><h2 id="state-gallery-title">Data states</h2></div>
          <Settings size={19} aria-hidden="true" />
        </div>
        <div className="reliability-grid">
          {states.map(({ id, label, tone, icon: Icon, title, description, value }) => (
            <article className={`reliability-card reliability-card--${tone}`} key={id}>
              <div className="reliability-card__topline">
                <span className={`state-badge state-badge--${tone}`}>
                  <Icon size={15} aria-hidden="true" />
                  {label}
                </span>
              </div>
              <strong className="reliability-card__value">{value}</strong>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
