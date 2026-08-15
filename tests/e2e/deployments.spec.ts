import { expect, test } from "@playwright/test";

const productionCommit = "111111111111";
const productionSha = `${productionCommit}${"1".repeat(28)}`;
const mainSha = "2222222222222222222222222222222222222222";

const inSyncPayload = {
  observedAt: "2026-08-15T21:00:00.000Z",
  project: {
    projectId: "rpi5-main",
    label: "RPi5 host configuration",
    repository: "rozkalnsandris/RPi5_main",
    classification: "IN_SYNC",
    productionCommit,
    productionSha,
    mainSha: productionSha,
    lastVerifiedDeployAt: "2026-08-15T20:00:00.000Z",
    aheadBy: 0,
    productionImpact: false,
    impactPaths: [],
  },
};

const deployRequiredPayload = {
  observedAt: "2026-08-15T21:00:00.000Z",
  project: {
    ...inSyncPayload.project,
    classification: "DEPLOY_REQUIRED",
    mainSha,
    aheadBy: 2,
    productionImpact: true,
    impactPaths: ["ops/bin/rpi5-backup", "scripts/rpi5_deploy_lib.py"],
  },
};

const unknownPayload = {
  observedAt: "2026-08-15T21:00:00.000Z",
  project: {
    ...inSyncPayload.project,
    classification: "UNKNOWN",
    productionSha: null,
    mainSha: null,
    aheadBy: null,
    productionImpact: null,
    impactPaths: [],
  },
};

test("Deployments renders verified in-sync evidence without selectors, writes or overflow", async ({ page }) => {
  const requestedUrls: string[] = [];
  await page.route("**/api/deployments", async (route) => {
    requestedUrls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(inSyncPayload),
    });
  });

  await page.goto("/deployments");
  await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "In sync" })).toBeVisible();
  await expect(page.getByText(productionCommit, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("rozkalnsandris/RPi5_main", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /deploy|authorize|rollback/i })).toHaveCount(0);

  expect(requestedUrls.length).toBeGreaterThan(0);
  expect(
    requestedUrls.every((url) => {
      const parsed = new URL(url);
      return parsed.pathname === "/api/deployments" && parsed.search === "";
    }),
  ).toBe(true);

  const pageText = await page.locator("body").innerText();
  for (const forbidden of [
    "/var/lib/rpi5-deploy",
    "/var/log/rpi5-deploy.log",
    "github_pat_",
    "ghp_",
    "Bearer ",
    "sudo ",
  ]) {
    expect(pageText).not.toContain(forbidden);
  }

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("Deployments marks reviewed production-impact drift as requiring a separately authorized deploy", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One project covers deployment-impact semantics");
  await page.route("**/api/deployments", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(deployRequiredPayload) }),
  );

  await page.goto("/deployments");
  await expect(page.getByRole("heading", { name: "Deploy required" })).toBeVisible();
  await expect(page.getByText(/Deployment still requires separate owner authorization/)).toBeVisible();
  await expect(page.getByText("ops/bin/rpi5-backup", { exact: true })).toBeVisible();
  await expect(page.getByText("scripts/rpi5_deploy_lib.py", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /deploy|authorize|rollback/i })).toHaveCount(0);
});

test("Deployments keeps incomplete GitHub correlation unknown", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One project covers unknown semantics");
  await page.route("**/api/deployments", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(unknownPayload) }),
  );

  await page.goto("/deployments");
  await expect(page.getByRole("heading", { name: "Unknown" })).toBeVisible();
  await expect(page.getByText(/cannot be proven/)).toBeVisible();
  await expect(page.getByText("Unknown", { exact: true }).first()).toBeVisible();
});
