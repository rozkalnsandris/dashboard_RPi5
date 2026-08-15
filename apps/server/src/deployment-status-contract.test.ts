import { describe, expect, it } from "vitest";

import { parseDeploymentStatusSnapshot } from "@dashboard-rpi5/contracts/deployment-status";

const productionCommit = "111111111111";
const productionSha = `${productionCommit}${"1".repeat(28)}`;
const mainSha = "2222222222222222222222222222222222222222";
const observedAt = "2026-08-15T21:00:00.000Z";
const lastVerifiedDeployAt = "2026-08-15T20:00:00.000Z";

function project(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "rpi5-main",
    label: "RPi5 host configuration",
    repository: "rozkalnsandris/RPi5_main",
    classification: "IN_SYNC",
    productionCommit,
    productionSha,
    mainSha: productionSha,
    lastVerifiedDeployAt,
    aheadBy: 0,
    productionImpact: false,
    impactPaths: [],
    ...overrides,
  };
}

describe("deployment status contract correlations", () => {
  it("rejects DEPLOY_REQUIRED without proven impact paths", () => {
    expect(() => parseDeploymentStatusSnapshot({
      observedAt,
      project: project({
        classification: "DEPLOY_REQUIRED",
        mainSha,
        aheadBy: 2,
        productionImpact: true,
        impactPaths: [],
      }),
    })).toThrow("Invalid deployment status");
  });

  it("rejects IN_SYNC when production and main differ", () => {
    expect(() => parseDeploymentStatusSnapshot({
      observedAt,
      project: project({ mainSha }),
    })).toThrow("Invalid deployment status");
  });

  it("rejects UNKNOWN when an ahead count is asserted", () => {
    expect(() => parseDeploymentStatusSnapshot({
      observedAt,
      project: project({
        classification: "UNKNOWN",
        productionSha: null,
        mainSha: null,
        aheadBy: 1,
        productionImpact: null,
      }),
    })).toThrow("Invalid deployment status");
  });

  it("rejects impact paths outside canonical reviewed order", () => {
    expect(() => parseDeploymentStatusSnapshot({
      observedAt,
      project: project({
        classification: "DEPLOY_REQUIRED",
        mainSha,
        aheadBy: 2,
        productionImpact: true,
        impactPaths: ["scripts/rpi5_deploy_lib.py", "ops/bin/rpi5-backup"],
      }),
    })).toThrow("Invalid deployment status");
  });
});
