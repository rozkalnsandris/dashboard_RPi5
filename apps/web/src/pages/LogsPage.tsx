import { Pause, Play, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "react-aria-components";

const logSources = [
  { id: "docker:homeassistant", label: "homeassistant" },
  { id: "docker:prometheus", label: "prometheus" },
  { id: "systemd:cloudflared", label: "cloudflared" },
  { id: "file:rpi5-backup", label: "rpi5-backup" },
] as const;

const fixtureLines = [
  { time: "14:41:03", level: "INFO", source: "homeassistant", message: "Health check completed in 184 ms" },
  { time: "14:40:57", level: "INFO", source: "prometheus", message: "Scrape cycle completed for node-exporter" },
  { time: "14:40:31", level: "WARN", source: "cloudflared", message: "Fixture tunnel latency sample exceeded baseline" },
  { time: "14:39:58", level: "INFO", source: "rpi5-backup", message: "Last fixture backup evidence remains fresh" },
  { time: "14:39:11", level: "INFO", source: "homeassistant", message: "Container remains healthy in fixture mode" },
] as const;

export function LogsPage() {
  const [sourceId, setSourceId] = useState<(typeof logSources)[number]["id"]>("docker:homeassistant");
  const [query, setQuery] = useState("");
  const [following, setFollowing] = useState(true);

  const source = logSources.find((item) => item.id === sourceId) ?? logSources[0];
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return fixtureLines.filter((line) => {
      const sourceMatch = sourceId === "docker:homeassistant" ? true : line.source === source.label;
      const textMatch = normalized.length === 0 || `${line.level} ${line.source} ${line.message}`.toLowerCase().includes(normalized);
      return sourceMatch && textMatch;
    });
  }, [query, source.label, sourceId]);

  return (
    <section className="page-stack log-page-shell" aria-labelledby="logs-title">
      <div className="page-heading page-heading--compact">
        <p className="eyebrow">Registered sources only</p>
        <h1 id="logs-title">Logs</h1>
        <p>Fixture explorer. The browser cannot provide a filesystem path, unit name, container ID or shell expression.</p>
      </div>

      <div className="log-toolbar" aria-label="Log filters">
        <label>
          <span>Source</span>
          <select value={sourceId} onChange={(event) => setSourceId(event.target.value as typeof sourceId)}>
            {logSources.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="log-search">
          <span>Search</span>
          <span className="input-shell">
            <Search size={16} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search fixture logs" />
          </span>
        </label>
        <Button className="toolbar-button" onPress={() => setFollowing((value) => !value)}>
          {following ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          {following ? "Pause" : "Follow"}
        </Button>
      </div>

      <div className="log-status" role="status">
        <span className={`status-dot${following ? "" : " status-dot--paused"}`} aria-hidden="true" />
        {following ? "Fixture follow active" : "Paused · new lines would be held"}
        <span>·</span>
        <span>{filtered.length} visible lines</span>
      </div>

      <div className="log-viewer" tabIndex={0} aria-label={`Fixture logs for ${source.label}`}>
        {filtered.length === 0 ? (
          <p className="empty-state">No fixture lines match this search.</p>
        ) : filtered.map((line) => (
          <div className="log-line" key={`${line.time}-${line.source}-${line.message}`}>
            <time>{line.time}</time>
            <strong data-level={line.level}>{line.level}</strong>
            <span className="log-source">{line.source}</span>
            <span>{line.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
