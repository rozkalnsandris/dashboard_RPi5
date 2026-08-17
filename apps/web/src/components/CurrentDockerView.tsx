import type { DockerContainerSnapshot } from "@dashboard-rpi5/contracts";
import { Box } from "lucide-react";

import {
  containerStatusLabel,
  formatBytes,
  formatPercent,
  formatUptime,
} from "../current-state-ui";

function ContainerStatus({ container }: { container: DockerContainerSnapshot }) {
  return <span className="count-pill">{containerStatusLabel(container)}</span>;
}

function cpu(container: DockerContainerSnapshot) {
  return formatPercent(container.stats?.cpuPercent ?? null);
}

function ram(container: DockerContainerSnapshot) {
  return formatBytes(container.stats?.memoryUsedBytes ?? null);
}

function network(container: DockerContainerSnapshot) {
  const rx = formatBytes(container.stats?.networkRxBytes ?? null);
  const tx = formatBytes(container.stats?.networkTxBytes ?? null);
  return rx === "Unavailable" || tx === "Unavailable" ? "Unavailable" : `↓${rx} ↑${tx}`;
}

export function CurrentDockerView({
  containers,
  limit,
}: {
  containers: DockerContainerSnapshot[];
  limit?: number;
}) {
  const visible = limit === undefined ? containers : containers.slice(0, limit);

  if (visible.length === 0) {
    return <p>No containers are present in the current Docker snapshot.</p>;
  }

  return (
    <>
      <div className="desktop-table-wrap">
        <table className="docker-table">
          <thead>
            <tr><th>Container</th><th>Status</th><th>CPU</th><th>RAM</th><th>Network</th><th>Uptime</th></tr>
          </thead>
          <tbody>
            {visible.map((container) => (
              <tr key={container.id}>
                <td><span className="container-name"><Box size={15} aria-hidden="true" />{container.name}</span></td>
                <td><ContainerStatus container={container} /></td>
                <td>{cpu(container)}</td>
                <td>{ram(container)}</td>
                <td>{network(container)}</td>
                <td>{formatUptime(container.uptimeSeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mobile-container-list">
        {visible.map((container) => (
          <article className="container-row" key={container.id}>
            <header><strong>{container.name}</strong><ContainerStatus container={container} /></header>
            <dl>
              <div><dt>CPU</dt><dd>{cpu(container)}</dd></div>
              <div><dt>RAM</dt><dd>{ram(container)}</dd></div>
              <div><dt>Network</dt><dd>{network(container)}</dd></div>
              <div><dt>Uptime</dt><dd>{formatUptime(container.uptimeSeconds)}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </>
  );
}
