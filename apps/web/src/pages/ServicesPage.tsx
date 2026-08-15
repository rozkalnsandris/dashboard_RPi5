import type { SystemdServiceSnapshot } from "@dashboard-rpi5/contracts/services";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ServerCog, ShieldAlert } from "lucide-react";

import { fetchSystemdServices } from "../services-api";
import {
  classifyService,
  formatServiceAge,
  serviceToneLabel,
  type ServiceTone,
} from "../services-ui";

const SERVICES_REFRESH_MS = 10_000;
const SERVICES_STALE_AFTER_MS = 30_000;

function StatusBadge({ tone }: { tone: ServiceTone }) {
  return (
    <span className={`service-status service-status--${tone}`}>
      <span className="service-status__dot" aria-hidden="true" />
      {serviceToneLabel(tone)}
    </span>
  );
}

function StateText({ service }: { service: SystemdServiceSnapshot }) {
  return (
    <span className="service-state-text">
      {service.activeState.toLowerCase()}
      {service.subState === null ? "" : ` / ${service.subState}`}
    </span>
  );
}

function ServiceCard({ service }: { service: SystemdServiceSnapshot }) {
  const tone = classifyService(service);
  return (
    <article className="service-card">
      <header>
        <div>
          <strong>{service.label}</strong>
          <code>{service.unitId}</code>
        </div>
        <StatusBadge tone={tone} />
      </header>
      <dl>
        <div>
          <dt>State</dt>
          <dd><StateText service={service} /></dd>
        </div>
        <div>
          <dt>Load</dt>
          <dd>{service.loadState.toLowerCase().replace("_", "-")}</dd>
        </div>
        <div>
          <dt>Enablement</dt>
          <dd>{service.enablement.toLowerCase().replaceAll("_", "-")}</dd>
        </div>
        <div>
          <dt>Restarts</dt>
          <dd>{service.restartCount === null ? "Unknown" : service.restartCount}</dd>
        </div>
        <div>
          <dt>State age</dt>
          <dd>{formatServiceAge(service.stateAgeSeconds)}</dd>
        </div>
      </dl>
    </article>
  );
}

export function ServicesPage() {
  const query = useQuery({
    queryKey: ["systemd-services"],
    queryFn: ({ signal }) => fetchSystemdServices(signal),
    staleTime: 5_000,
    refetchInterval: SERVICES_REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  const ageMs = query.data === undefined ? 0 : Date.now() - Date.parse(query.data.observedAt);
  const stale = query.data !== undefined && ageMs > SERVICES_STALE_AFTER_MS;
  const degraded = query.isRefetchError && query.data !== undefined;
  const counts = query.data?.services.reduce(
    (result, service) => {
      result[classifyService(service)] += 1;
      return result;
    },
    { healthy: 0, attention: 0, critical: 0, unknown: 0 },
  );

  return (
    <section className="page-stack services-page" aria-labelledby="services-page-title">
      <div className="page-heading services-page__heading">
        <div>
          <p className="eyebrow">Allowlisted native services</p>
          <h1 id="services-page-title">Services</h1>
          <p>Read-only systemd evidence from a fixed source registry. No start, stop, restart or arbitrary unit lookup is exposed.</p>
        </div>
        <ServerCog size={28} aria-hidden="true" />
      </div>

      {query.isPending ? (
        <div className="services-message" role="status">
          <RefreshCw size={18} aria-hidden="true" />
          <div><strong>Checking service state…</strong><span>Waiting for bounded local-agent evidence.</span></div>
        </div>
      ) : null}

      {query.isError && query.data === undefined ? (
        <div className="services-message services-message--warning" role="status">
          <ShieldAlert size={18} aria-hidden="true" />
          <div><strong>Service evidence unavailable</strong><span>No service is shown as healthy without trustworthy evidence.</span></div>
        </div>
      ) : null}

      {query.data !== undefined ? (
        <>
          <div className="services-summary" aria-label="Service health summary">
            <span><strong>{query.data.services.length}</strong> allowlisted</span>
            <span><strong>{counts?.healthy ?? 0}</strong> healthy</span>
            <span><strong>{counts?.attention ?? 0}</strong> attention</span>
            <span><strong>{counts?.critical ?? 0}</strong> critical</span>
            <span><strong>{counts?.unknown ?? 0}</strong> unknown</span>
          </div>

          {stale || degraded ? (
            <div className="services-message services-message--warning" role="status">
              <ShieldAlert size={18} aria-hidden="true" />
              <div>
                <strong>{degraded ? "Latest service refresh failed" : "Service evidence is stale"}</strong>
                <span>Showing the last trustworthy snapshot and keeping its age visible.</span>
              </div>
            </div>
          ) : null}

          <div className="services-mobile-list">
            {query.data.services.map((service) => <ServiceCard key={service.unitId} service={service} />)}
          </div>

          <div className="services-table-wrap">
            <table className="services-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Health</th>
                  <th>State</th>
                  <th>Load</th>
                  <th>Enablement</th>
                  <th>Restarts</th>
                  <th>State age</th>
                </tr>
              </thead>
              <tbody>
                {query.data.services.map((service) => {
                  const tone = classifyService(service);
                  return (
                    <tr key={service.unitId}>
                      <td><strong>{service.label}</strong><code>{service.unitId}</code></td>
                      <td><StatusBadge tone={tone} /></td>
                      <td><StateText service={service} /></td>
                      <td>{service.loadState.toLowerCase().replace("_", "-")}</td>
                      <td>{service.enablement.toLowerCase().replaceAll("_", "-")}</td>
                      <td>{service.restartCount === null ? "Unknown" : service.restartCount}</td>
                      <td>{formatServiceAge(service.stateAgeSeconds)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <footer className="services-footer">
            <span>Observed {new Date(query.data.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            <span className="services-refresh" aria-live="polite">
              {query.isFetching ? <RefreshCw size={14} aria-hidden="true" /> : null}
              {query.isFetching ? "Refreshing" : "10s refresh"}
            </span>
          </footer>
        </>
      ) : null}
    </section>
  );
}
