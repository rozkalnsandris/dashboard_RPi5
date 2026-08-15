import { expect, test } from "@playwright/test";

const success = {
  runId: "backup-success",
  startedAt: "2026-08-15T00:00:00.000Z",
  completedAt: "2026-08-15T00:02:00.000Z",
  result: "SUCCESS",
  durationSeconds: 120,
  sizeBytes: 123_456,
  exitCode: 0,
};

const failed = {
  runId: "backup-failed",
  startedAt: "2026-08-15T01:00:00.000Z",
  completedAt: "2026-08-15T01:01:00.000Z",
  result: "FAILED",
  durationSeconds: 60,
  sizeBytes: null,
  exitCode: 23,
};

const policy = {
  destinationLabel: "Encrypted Google Drive",
  scheduleLabel: "Daily at 02:00 host local time",
  localRetentionDays: 7,
  remoteRetentionDays: 30,
  freshnessBudgetHours: 30,
};

const healthyPayload = {
  observedAt: "2026-08-15T02:00:00.000Z",
  health: "HEALTHY",
  freshness: "FRESH",
  latestRun: success,
  lastSuccessfulAt: success.completedAt,
  ageSeconds: 7_080,
  policy,
  history: [success],
};

const failedPayload = {
  observedAt: "2026-08-15T02:00:00.000Z",
  health: "ATTENTION",
  freshness: "FRESH",
  latestRun: failed,
  lastSuccessfulAt: success.completedAt,
  ageSeconds: 7_080,
  policy,
  history: [failed, success],
};

const stalePayload = {
  observedAt: "2026-08-16T06:02:01.000Z",
  health: "ATTENTION",
  freshness: "STALE",
  latestRun: success,
  lastSuccessfulAt: success.completedAt,
  ageSeconds: 108_001,
  policy,
  history: [success],
};

test("Backups renders normalized healthy evidence without overflow or private paths", async ({ page }) => {
  const requestedUrls: string[] = [];
  await page.route("**/api/backups", async (route) => {
    requestedUrls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(healthyPayload),
    });
  });

  await page.goto("/backups");
  await expect(page.getByRole("heading", { name: "Backups" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Healthy" })).toBeVisible();
  await expect(page.getByText("Fresh", { exact: true })).toBeVisible();
  await expect(page.getByText("Encrypted Google Drive", { exact: true })).toBeVisible();
  await expect(page.getByText("Daily at 02:00 host local time", { exact: true })).toBeVisible();
  await expect(page.getByText("7 days", { exact: true })).toBeVisible();
  await expect(page.getByText("30 days", { exact: true })).toBeVisible();
  await expect(page.getByText("Succeeded", { exact: true }).first()).toBeVisible();

  expect(requestedUrls.length).toBeGreaterThan(0);
  expect(requestedUrls.every((url) => new URL(url).pathname === "/api/backups" && new URL(url).search === "")).toBe(true);

  const pageText = await page.locator("body").innerText();
  for (const forbidden of ["/opt/backups", "gdrive:", "rclone", "age.key", "age-recipient", "/etc/"]) {
    expect(pageText).not.toContain(forbidden);
  }

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("Backups marks a latest failed run as attention without losing prior success freshness", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One project covers failure semantics");
  await page.route("**/api/backups", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(failedPayload) }),
  );

  await page.goto("/backups");
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.getByText("The latest completed backup failed.")).toBeVisible();
  await expect(page.getByText("Fresh", { exact: true })).toBeVisible();
  await expect(page.getByText("Failed", { exact: true }).first()).toBeVisible();
});

test("Overview surfaces stale backup evidence as needs attention and hides fixture all-clear", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One project covers overview attention semantics");
  await page.route("**/api/backups", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stalePayload) }),
  );

  await page.goto("/");
  await expect(page.getByText("Backup needs attention", { exact: true })).toBeVisible();
  await expect(page.getByText(/older than the 30-hour freshness budget/)).toBeVisible();
  await expect(page.getByText("All clear", { exact: true })).toBeHidden();
});

test("Overview keeps unavailable backup evidence unknown instead of all-clear", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One project covers unavailable semantics");
  await page.route("**/api/backups", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"SOURCE_UNAVAILABLE"}' }),
  );

  await page.goto("/");
  await expect(page.getByText("Backup evidence unknown", { exact: true })).toBeVisible();
  await expect(page.getByText("The structured backup source is unavailable; this is not treated as all-clear.", { exact: true })).toBeVisible();
  await expect(page.getByText("All clear", { exact: true })).toBeHidden();
});
