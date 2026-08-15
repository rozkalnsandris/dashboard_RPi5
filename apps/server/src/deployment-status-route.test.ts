import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

const apps: ReturnType<typeof buildApp>[] = [];
const productionCommit = "111111111111";
const productionSha = `${productionCommit}${"1".repeat(28)}`;
const mainSha = "2222222222222222222222222222222222222222";

const snapshot = {
  observedAt: "2026-08-15T21:00:00.000Z",
  project: {
    projectId: "rpi5-main" as const,
    label: "RPi5 host configuration" as const,
    repository: "rozkalnsandris/RPi5_main" as const,
    classification: "DEPLOY_REQUIRED" as const,
    productionCommit,
    productionSha,
    mainSha,
    lastVerifiedDeployAt: "2026-08-15T20:00:00.000Z",
    aheadBy: 2,
    productionImpact: true,
    impactPaths: ["ops/bin/rpi5-backup" as const],
  },
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Phase 6C deployment status API", () => {
  it("returns only normalized no-store deployment state", async () => {
    const app = buildApp({ deploymentStatusReader: async () => snapshot });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/deployments" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual(snapshot);

    for (const forbidden of [
      "/var/lib/rpi5-deploy",
      "/var/log/rpi5-deploy.log",
      "Authorization",
      "Bearer ",
      "github_pat_",
      "ghp_",
      "sudo ",
    ]) {
      expect(response.body).not.toContain(forbidden);
    }
  });

  it("rejects every browser repository, ref, path and action selector", async () => {
    const app = buildApp({ deploymentStatusReader: async () => snapshot });
    apps.push(app);

    for (const url of [
      "/api/deployments?repo=other%2Frepo",
      "/api/deployments?ref=feature",
      "/api/deployments?sha=deadbeef",
      "/api/deployments?path=%2Fetc%2Fshadow",
      "/api/deployments?action=deploy",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(400);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toEqual({ error: "INVALID_REQUEST" });
    }
  });

  it("normalizes source failure without leaking network or host details", async () => {
    const app = buildApp({
      deploymentStatusReader: async () => {
        throw new Error("https://api.github.com token /var/lib/rpi5-deploy");
      },
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/deployments" });
    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ error: "SOURCE_UNAVAILABLE" });
    expect(response.body).not.toContain("github.com");
    expect(response.body).not.toContain("rpi5-deploy");
  });
});
