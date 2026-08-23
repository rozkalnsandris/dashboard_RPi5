import { describe, expect, it, vi } from "vitest";

import type { DeployEventsSnapshot } from "@dashboard-rpi5/contracts/deploy";

import {
  createDeploymentStatusReader,
  DeploymentStatusSourceUnavailableError,
} from "./deployment-status.js";

const productionCommit = "111111111111";
const productionSha = `${productionCommit}${"1".repeat(28)}`;
const mainSha = "2222222222222222222222222222222222222222";
const occurredAt = "2026-08-15T20:00:00.000Z";
const observedAt = "2026-08-15T21:00:00.000Z";

function deployEvidence(events: DeployEventsSnapshot["events"]): DeployEventsSnapshot {
  return { observedAt: "2026-08-15T20:30:00.000Z", events };
}

const verifiedEvent = {
  transactionId: `20260815T200000000000Z-${productionCommit}`,
  commit: productionCommit,
  occurredAt,
} as const;

describe("deployment status reader", () => {
  it("keeps an empty verified-deploy window UNKNOWN without calling GitHub", async () => {
    const githubMainReader = vi.fn();
    const read = createDeploymentStatusReader({
      deployEventsReader: async () => deployEvidence([]),
      githubMainReader,
      now: () => new Date(observedAt),
    });

    await expect(read()).resolves.toMatchObject({
      observedAt,
      project: {
        classification: "UNKNOWN",
        productionCommit: null,
        productionSha: null,
        mainSha: null,
        lastVerifiedDeployAt: null,
        aheadBy: null,
        productionImpact: null,
        impactPaths: [],
      },
    });
    expect(githubMainReader).not.toHaveBeenCalled();
  });

  it("classifies a verified production commit equal to main as IN_SYNC", async () => {
    const read = createDeploymentStatusReader({
      deployEventsReader: async () => deployEvidence([verifiedEvent]),
      githubMainReader: async () => ({
        productionSha,
        mainSha: productionSha,
        relation: "IN_SYNC",
        aheadBy: 0,
        changedFiles: [],
      }),
      now: () => new Date(observedAt),
    });

    await expect(read()).resolves.toMatchObject({
      project: {
        classification: "IN_SYNC",
        productionCommit,
        productionSha,
        mainSha: productionSha,
        lastVerifiedDeployAt: occurredAt,
        aheadBy: 0,
        productionImpact: false,
        impactPaths: [],
      },
    });
  });

  it("classifies docs-only main drift as MAIN_AHEAD_NO_DEPLOY", async () => {
    const read = createDeploymentStatusReader({
      deployEventsReader: async () => deployEvidence([verifiedEvent]),
      githubMainReader: async () => ({
        productionSha,
        mainSha,
        relation: "AHEAD",
        aheadBy: 4,
        changedFiles: ["README.md", "docs/CV.md"],
      }),
      now: () => new Date(observedAt),
    });

    await expect(read()).resolves.toMatchObject({
      project: {
        classification: "MAIN_AHEAD_NO_DEPLOY",
        aheadBy: 4,
        productionImpact: false,
        impactPaths: [],
      },
    });
  });

  it("classifies the reviewed V25 target bundle and deploy engine as DEPLOY_REQUIRED", async () => {
    const read = createDeploymentStatusReader({
      deployEventsReader: async () => deployEvidence([verifiedEvent]),
      githubMainReader: async () => ({
        productionSha,
        mainSha,
        relation: "AHEAD",
        aheadBy: 2,
        changedFiles: [
          "scripts/rpi5_deploy_lib.py",
          "ops/lib/rpi5-maintenance-locks.sh",
          "ops/bin/rpi5-backup-serialized",
          "ops/bin/rpi5-backup",
          "README.md",
        ],
      }),
      now: () => new Date(observedAt),
    });

    await expect(read()).resolves.toMatchObject({
      project: {
        classification: "DEPLOY_REQUIRED",
        aheadBy: 2,
        productionImpact: true,
        impactPaths: [
          "ops/bin/rpi5-backup",
          "ops/bin/rpi5-backup-serialized",
          "ops/lib/rpi5-maintenance-locks.sh",
          "scripts/rpi5_deploy_lib.py",
        ],
      },
    });
  });

  it("keeps GitHub failure UNKNOWN while preserving verified local evidence", async () => {
    const read = createDeploymentStatusReader({
      deployEventsReader: async () => deployEvidence([verifiedEvent]),
      githubMainReader: async () => { throw new Error("rate limited"); },
      now: () => new Date(observedAt),
    });

    await expect(read()).resolves.toMatchObject({
      project: {
        classification: "UNKNOWN",
        productionCommit,
        productionSha: null,
        mainSha: null,
        lastVerifiedDeployAt: occurredAt,
        aheadBy: null,
        productionImpact: null,
      },
    });
  });

  it("keeps divergent Git history UNKNOWN instead of guessing deploy state", async () => {
    const read = createDeploymentStatusReader({
      deployEventsReader: async () => deployEvidence([verifiedEvent]),
      githubMainReader: async () => ({
        productionSha,
        mainSha,
        relation: "DIVERGED",
        aheadBy: null,
        changedFiles: [],
      }),
      now: () => new Date(observedAt),
    });

    await expect(read()).resolves.toMatchObject({
      project: {
        classification: "UNKNOWN",
        productionSha,
        mainSha,
        aheadBy: null,
        productionImpact: null,
      },
    });
  });

  it("fails closed when root-authenticated deploy evidence is future-dated", async () => {
    const futureEvent = { ...verifiedEvent, occurredAt: "2026-08-16T00:00:00.000Z" };
    const read = createDeploymentStatusReader({
      deployEventsReader: async () => deployEvidence([futureEvent]),
      githubMainReader: vi.fn(),
      now: () => new Date(observedAt),
    });

    await expect(read()).rejects.toBeInstanceOf(DeploymentStatusSourceUnavailableError);
  });
});
