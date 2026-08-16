import type { QuickCommandId } from "@dashboard-rpi5/contracts/quick-commands";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight, LockKeyhole, TerminalSquare } from "lucide-react";
import { Button } from "react-aria-components";

import { FullTerminalPanel } from "../components/FullTerminalPanel";
import { fetchQuickCommandCatalog, QuickCommandRequestError, runQuickCommand } from "../quick-commands-api";

function errorText(error: unknown) {
  if (error instanceof QuickCommandRequestError && error.kind === "OPERATION_TIMEOUT") {
    return "Command timed out before a bounded result was available.";
  }
  return "Quick Command evidence is unavailable. No host state is inferred.";
}

export function TerminalPage() {
  const catalog = useQuery({
    queryKey: ["quick-commands"],
    queryFn: ({ signal }) => fetchQuickCommandCatalog(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const command = useMutation({
    mutationFn: (commandId: QuickCommandId) => runQuickCommand(commandId),
  });

  const resultText = command.isPending
    ? "Running bounded read-only diagnostic…"
    : command.isError
      ? errorText(command.error)
      : command.data === undefined
        ? "Select a registered Quick Command. Free-form shell input is not accepted here."
        : [
            command.data.stdout,
            command.data.stderr === "" ? "" : `stderr:\n${command.data.stderr}`,
          ].filter(Boolean).join("\n\n") || "Command completed with no output.";

  return (
    <section className="page-stack" aria-labelledby="terminal-title">
      <div className="page-heading">
        <p className="eyebrow">Owner diagnostics · explicit sessions only</p>
        <h1 id="terminal-title">Terminal</h1>
        <p>Use registered read-only diagnostics first. The full PTY below is a separate owner-only session and never starts just by opening this page.</p>
      </div>

      <div className="terminal-grid">
        <section className="panel quick-command-panel" aria-labelledby="quick-commands-title">
          <div className="panel-heading">
            <div><p className="eyebrow">Bounded diagnostics</p><h2 id="quick-commands-title">Quick Commands</h2></div>
            <TerminalSquare size={19} aria-hidden="true" />
          </div>

          {catalog.isPending ? <p className="quick-command-state" role="status">Loading registered commands…</p> : null}
          {catalog.isError ? <p className="quick-command-state quick-command-state--error" role="alert">Registered commands unavailable.</p> : null}
          {catalog.data !== undefined ? (
            <div className="quick-command-list">
              {catalog.data.commands.map((item) => (
                <Button
                  key={item.id}
                  className="quick-command"
                  isDisabled={command.isPending}
                  onPress={() => command.mutate(item.id)}
                >
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                  <ChevronRight size={18} aria-hidden="true" />
                </Button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="panel terminal-result-panel" aria-labelledby="terminal-output-title">
          <div className="panel-heading">
            <div><p className="eyebrow">Untrusted plain-text output</p><h2 id="terminal-output-title">Quick Command output</h2></div>
            <span className="count-pill">READ ONLY</span>
          </div>

          {command.data !== undefined ? (
            <div className="quick-command-meta" aria-label="Last command result">
              <strong>{command.data.status}</strong>
              <span>{command.data.durationMs} ms</span>
              <span>exit {command.data.exitCode ?? "signal"}</span>
            </div>
          ) : null}
          <pre className="terminal-output" aria-live="polite"><code>{resultText}</code></pre>

          <div className="terminal-lock-note">
            <LockKeyhole size={18} aria-hidden="true" />
            <p><strong>Quick Commands stay bounded.</strong> This panel never accepts a shell string, executable, arguments or paths from the browser.</p>
          </div>
        </section>
      </div>

      <FullTerminalPanel />
    </section>
  );
}
