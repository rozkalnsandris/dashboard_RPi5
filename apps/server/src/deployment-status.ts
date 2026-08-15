import {
  DEPLOYMENT_IMPACT_PATHS,
  DEPLOYMENT_PROJECT_ID,
  DEPLOYMENT_PROJECT_LABEL,
  DEPLOYMENT_REPOSITORY,
  parseDeploymentStatusSnapshot,
  type DeploymentClassification,
  type DeploymentImpactPath,
  type DeploymentStatusSnapshot,
} from "@dashboard-rpi5/contracts/deployment-status";

import type { DeployEventsReader } from "./agent-deploy-events-client.js";
import type { GithubRpi5MainReader } from "./github-rpi5-main-client.js";

export type DeploymentStatusReader = () => Promise<DeploymentStatusSnapshot>;

interface DeploymentStatusReaderOptions {
  deployEventsReader: DeployEventsReader;
  githubMainReader: GithubRpi5MainReader;
  now?: () => Date;
}

export class DeploymentStatusSourceUnavailableError extends Error {
  constructor() {
    super("Deployment status source unavailable");
    this.name = "DeploymentStatusSourceUnavailableError";
  }
}

const IMPACT_PATH_SET = new Set<string>(DEPLOYMENT_IMPACT_PATHS);
const IMPACT_PATH_RANK = new Map<string, number>(
  DEPLOYMENT_IMPACT_PATHS.map((path, index) => [path, index]),
);

function unknownSnapshot(
  observedAt: string,
  productionCommit: string | null,
  lastVerifiedDeployAt: string | null,
  productionSha: string | null = null,
  mainSha: string | null = null,
): DeploymentStatusSnapshot {
  return parseDeploymentStatusSnapshot({
    observedAt,
    project: {
      projectId: DEPLOYMENT_PROJECT_ID,
      label: DEPLOYMENT_PROJECT_LABEL,
      repository: DEPLOYMENT_REPOSITORY,
      classification: "UNKNOWN",
      productionCommit,
      productionSha,
      mainSha,
      lastVerifiedDeployAt,
      aheadBy: null,
      productionImpact: null,
      impactPaths: [],
    },
  });
}

export function createDeploymentStatusReader(
  options: DeploymentStatusReaderOptions,
): DeploymentStatusReader {
  const now = options.now ?? (() => new Date());

  return async () => {
    let evidence;
    try {
      evidence = await options.deployEventsReader();
    } catch {
      throw new DeploymentStatusSourceUnavailableError();
    }

    const observedDate = now();
    if (!Number.isFinite(observedDate.getTime())) {
      throw new DeploymentStatusSourceUnavailableError();
    }
    const observedAt = observedDate.toISOString();
    const latest = evidence.events[0] ?? null;
    if (latest === null) {
      return unknownSnapshot(observedAt, null, null);
    }
    if (Date.parse(latest.occurredAt) > observedDate.getTime()) {
      throw new DeploymentStatusSourceUnavailableError();
    }

    let github;
    try {
      github = await options.githubMainReader(latest.commit);
    } catch {
      return unknownSnapshot(observedAt, latest.commit, latest.occurredAt);
    }

    if (github.relation === "DIVERGED") {
      return unknownSnapshot(
        observedAt,
        latest.commit,
        latest.occurredAt,
        github.productionSha,
        github.mainSha,
      );
    }

    let classification: DeploymentClassification;
    let productionImpact: boolean;
    let impactPaths: DeploymentImpactPath[] = [];

    if (github.relation === "IN_SYNC") {
      classification = "IN_SYNC";
      productionImpact = false;
    } else {
      const uniqueImpactPaths = [...new Set(
        github.changedFiles.filter((path) => IMPACT_PATH_SET.has(path)),
      )] as DeploymentImpactPath[];
      impactPaths = uniqueImpactPaths.sort(
        (left, right) => (IMPACT_PATH_RANK.get(left) ?? 99) - (IMPACT_PATH_RANK.get(right) ?? 99),
      );
      productionImpact = impactPaths.length > 0;
      classification = productionImpact ? "DEPLOY_REQUIRED" : "MAIN_AHEAD_NO_DEPLOY";
    }

    return parseDeploymentStatusSnapshot({
      observedAt,
      project: {
        projectId: DEPLOYMENT_PROJECT_ID,
        label: DEPLOYMENT_PROJECT_LABEL,
        repository: DEPLOYMENT_REPOSITORY,
        classification,
        productionCommit: latest.commit,
        productionSha: github.productionSha,
        mainSha: github.mainSha,
        lastVerifiedDeployAt: latest.occurredAt,
        aheadBy: github.aheadBy,
        productionImpact,
        impactPaths,
      },
    });
  };
}
