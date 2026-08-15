import { ChevronRight, LockKeyhole, TerminalSquare } from "lucide-react";
import { useState } from "react";
import { Button } from "react-aria-components";

const quickCommands = [
  { id: "system-info", label: "System info", description: "Kernel, uptime and host identity", output: "Fixture: Raspberry Pi 5 · Debian · uptime 37d 14h" },
  { id: "temperature", label: "Temperature + throttle", description: "SoC temperature and decoded power flags", output: "Fixture: 43°C · no throttle or under-voltage flags" },
  { id: "docker-stats", label: "Docker stats", description: "One bounded resource snapshot", output: "Fixture: 16/16 expected containers running" },
  { id: "disk-usage", label: "Disk usage", description: "Root filesystem usage", output: "Fixture: NVMe root filesystem 41% used" },
  { id: "backup-status", label: "Backup status", description: "Last controlled backup evidence", output: "Fixture: last backup completed successfully at 02:00" },
] as const;

export function TerminalPage() {
  const [result, setResult] = useState("Select a registered Quick Command. Nothing is executed on the RPi5 in Phase 1.");

  return (
    <section className="page-stack" aria-labelledby="terminal-title">
      <div className="page-heading">
        <p className="eyebrow">Owner diagnostics · fixture only</p>
        <h1 id="terminal-title">Terminal</h1>
        <p>Phone-first diagnostics start with registered command IDs. Free-form PTY access remains deliberately disabled.</p>
      </div>

      <div className="terminal-grid">
        <section className="panel quick-command-panel" aria-labelledby="quick-commands-title">
          <div className="panel-heading">
            <div><p className="eyebrow">Bounded diagnostics</p><h2 id="quick-commands-title">Quick Commands</h2></div>
            <TerminalSquare size={19} aria-hidden="true" />
          </div>
          <div className="quick-command-list">
            {quickCommands.map((command) => (
              <Button key={command.id} className="quick-command" onPress={() => setResult(command.output)}>
                <span>
                  <strong>{command.label}</strong>
                  <small>{command.description}</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </Button>
            ))}
          </div>
        </section>

        <section className="panel terminal-result-panel" aria-labelledby="terminal-output-title">
          <div className="panel-heading">
            <div><p className="eyebrow">Local fixture output</p><h2 id="terminal-output-title">Output</h2></div>
            <span className="count-pill">READ ONLY</span>
          </div>
          <pre className="terminal-output"><code>$ {result}</code></pre>
          <div className="terminal-lock-note">
            <LockKeyhole size={18} aria-hidden="true" />
            <p><strong>Full terminal locked.</strong> PTY, sudo, Docker exec and arbitrary shell strings are outside Phase 1.</p>
          </div>
        </section>
      </div>
    </section>
  );
}
