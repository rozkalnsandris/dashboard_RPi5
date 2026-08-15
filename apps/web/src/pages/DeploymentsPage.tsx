import type {
  DeploymentClassification,
  DeploymentProjectState,
} from "@dashboard-rpi5/contracts/deployment-status";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CircleCheck,
  Clock3,
  FileWarning,
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router";

import { fetchDeploymentStatus } from "../deployments-api";

const DEPLOYMENT_REFRESH_MS = 30_000;

function formatTimestamp(value: string | null): string {
  if (value === null) return "Unknown";
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

function shortSha(fullSha: string | null, verifiedShort: string | null): string {
  if (fullSha !== null) return fullSha.slice(0, 12);
  return verifiedShort ?? "Unknown";
}

function classificationLabel(classification: DeploymentClassification): string {
  switch (classification) {
    case "IN_SYNC": return "In sync";
    case "MAIN_AHEAD_NO_DEPLOY": return "Main ahead · no deploy impact";
    case "DEPLOY_REQUIRED": return "Deploy required";
    case "DEPLOY_PENDING_AUTH": return "Deploy pending authorization";
    case "UNKNOWN": return "Unknown";
  }
}

function classificationReason(project: DeploymentProjectState): string {
  switch (project.classification) {
    case "IN_SYNC":
      return "The newest verified production commit matches GitHub main.";
    case "MAIN_AHEAD_NO_DEPLOY":
      return "GitHub main is ahead, but none of the reviewed production-impact paths changed.";
    case "DEPLOY_REQUIRED":
      return "GitHub main contains reviewed production-impact changes. Deployment still requires separate owner authorization.";
    case "DEPLOY_PENDING_AUTH":
      return "Deployment impact is proven and a separate authorization evidence source marks the action as pending.";
    case "UNKNOWN":
      return "Production alignment cannot be proven from the currently available verified deploy and GitHub evidence.";
  }
}

function ClassificationIcon({ classification }: { classification: DeploymentClassification }) {
  if (classification === "IN_SYNC") return <CircleCheck size={23} aria-hidden="true" />;
  if (classification === "UNKNOWN") return <ShieldAlert size={23} aria-hidden="true" />;
  return <FileWarning size={23} aria-hidden="true" />;
}

export function DeploymentsPage() {
  const deploymentQuery = useQuery({
    queryKey: ["deployment-status"],
    queryFn: ({ signal }) => fetchDeploymentStatus(signal),
    staleTime: 0,
    refetchInterval: DEPLOYMENT_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  const snapshot = deploymentQuery.data;
  const sourceFailure = deploymentQuery.isError && snapshot === undefined;

  return (
    <section className="page-stack deployments-page" aria-labelledby="deployments-page-title">
      <div className="page-heading page-heading--compact">
        <p className="eyebrow">Verified production alignment</p>
        <h1 id="deployments-page-title">Deployments</h1>
        <p>Read-only comparison of the latest root-authenticated RPi5 deploy evidence with the fixed public GitHub main branch. This page cannot deploy, authorize or mutate production.</p>
      </div>

      {deploymentQuery.isPending && !sourceFailure ? (
        <div className="logs-message" role="status">
          <RefreshCw size={18} aria-hidden="true" />
          <div><strong>Loading deployment evidence…</strong><span>Correlating verified local evidence with bounded GitHub read evidence.</span></div>
        </div>
      ) : null}

      {sourceFailure ? (
        <div className="logs-message logs-message--warning" role="status">
          <ShieldAlert size={18} aria-hidden="true" />
          <div><strong>Deployment evidence unavailable</strong><span>Production alignment is unknown. Missing evidence is never treated as in sync.</span></div>
        </div>
      ) : null}

      {snapshot !== undefined ? (
        <>
          <section
            className="deployment-state-card"
            data-classification={snapshot.project.classification}
            aria-labelledby="deployment-state-title"
          >
            <div className="deployment-state-card__icon">
              <ClassificationIcon classification={snapshot.project.classification} />
            </div>
            <div>
              <p className="eyebrow">{snapshot.project.label}</p>
              <h2 id="deployment-state-title">{classificationLabel(snapshot.project.classification)}</h2>
              <p>{classificationReason(snapshot.project)}</p>
            </div>
            <span className="deployment-state-pill" data-classification={snapshot.project.classification}>
              {classificationLabel(snapshot.project.classification)}
            </span>
          </section>

          <section className="deployment-summary-grid" aria-label="Deployment comparison">
            <article className="deployment-summary-card">
              <GitCommitHorizontal size={18} aria-hidden="true" />
              <span>Production</span>
              <strong>{shortSha(snapshot.project.productionSha, snapshot.project.productionCommit)}</strong>
              <small>Latest verified successful deploy</small>
            </article>
            <article className="deployment-summary-card">
              <GitBranch size={18} aria-hidden="true" />
              <span>GitHub main</span>
              <strong>{shortSha(snapshot.project.mainSha, null)}</strong>
              <small>{snapshot.project.repository}</small>
            </article>
            <article className="deployment-summary-card">
              <ArrowRight size={18} aria-hidden="true" />
              <span>Main ahead</span>
              <strong>{snapshot.project.aheadBy === null ? "Unknown" : snapshot.project.aheadBy}</strong>
              <small>Commits after proven production</small>
            </article>
            <article className="deployment-summary-card">
              <Clock3 size={18} aria-hidden="true" />
              <span>Last verified deploy</span>
              <strong>{formatTimestamp(snapshot.project.lastVerifiedDeployAt)}</strong>
              <small>Root-authenticated journal evidence</small>
            </article>
          </section>

          {snapshot.project.impactPaths.length > 0 ? (
            <section className="panel deployment-impact-panel" aria-labelledby="deployment-impact-title">
              <div className="panel-heading">
                <div><p className="eyebrow">Reviewed impact policy</p><h2 id="deployment-impact-title">Production-impact changes</h2></div>
                <FileWarning size={19} aria-hidden="true" />
              </div>
              <ul className="deployment-impact-list">
                {snapshot.project.impactPaths.map((path) => <li key={path}><code>{path}</code></li>)}
              </ul>
              <p className="deployment-policy-note">These paths prove deployment impact only. They do not authorize a deployment.</p>
            </section>
          ) : null}

          <section className="panel deployment-boundary-panel" aria-labelledby="deployment-boundary-title">
            <div className="panel-heading">
              <div><p className="eyebrow">Trust boundary</p><h2 id="deployment-boundary-title">Read-only by design</h2></div>
              <ShieldCheck size={19} aria-hidden="true" />
            </div>
            <p>GitHub repository, branch and comparison targets are fixed server-side. The browser cannot provide a repository, ref, path or deployment action. `DEPLOY_PENDING_AUTH` is not inferred until a separate explicit owner-authorization evidence source exists.</p>
            <Link className="panel-link" to="/activity">Open deploy activity <ArrowRight size={16} aria-hidden="true" /></Link>
          </section>

          <p className="deployment-observed-at">Observed {formatTimestamp(snapshot.observedAt)} · visible refresh every 30 seconds</p>
        </>
      ) : null}
    </section>
  );
}
