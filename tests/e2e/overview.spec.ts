import { expect, test } from "@playwright/test";

const overviewBackupSuccess = {
  runId: "backup-success",
  startedAt: "2026-08-15T00:00:00.000Z",
  completedAt: "2026-08-15T00:02:00.000Z",
  result: "SUCCESS",
  durationSeconds: 120,
  sizeBytes: 123_456,
  exitCode: 0,
};

const overviewBackupPayload = {
  observedAt: "2026-08-15T02:00:00.000Z",
  health: "HEALTHY",
  freshness: "FRESH",
  latestRun: overviewBackupSuccess,
  lastSuccessfulAt: overviewBackupSuccess.completedAt,
  ageSeconds: 7_080,
  policy: {
    destinationLabel: "Encrypted Google Drive",
    scheduleLabel: "Daily at 02:00 host local time",
    localRetentionDays: 7,
    remoteRetentionDays: 30,
    freshnessBudgetHours: 30,
  },
  history: [overviewBackupSuccess],
};

test("overview renders live backup health without page overflow", async ({ page }) => {
  await page.route("**/api/backups", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(overviewBackupPayload),
    }),
  );

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Raspberry Pi 5" })).toBeVisible();
  await expect(page.getByText("Backup fresh", { exact: true })).toBeVisible();
  await expect(page.getByText("All clear", { exact: true })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Docker" })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("shell uses touch navigation on phone projects and sidebar on desktop", async ({ page }, testInfo) => {
  await page.goto("/");

  const mobile = testInfo.project.name !== "desktop-1440";
  const primary = page.getByRole("navigation", { name: "Primary navigation" });
  const desktop = page.getByRole("navigation", { name: "Dashboard navigation" });

  if (mobile) {
    await expect(primary).toBeVisible();
    await expect(desktop).toBeHidden();
    await expect(primary.getByRole("link", { name: "Overview" })).toBeVisible();
    await expect(primary.getByRole("link", { name: "Docker" })).toBeVisible();
    await expect(primary.getByRole("link", { name: "Logs" })).toBeVisible();
    await expect(primary.getByRole("link", { name: "Terminal" })).toBeVisible();
    await expect(primary.getByRole("button", { name: "More destinations" })).toBeVisible();
  } else {
    await expect(desktop).toBeVisible();
    await expect(primary).toBeHidden();
  }
});

test("mobile More menu performs touch route navigation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop-1440", "Mobile overflow menu is not rendered in the desktop shell");
  await page.goto("/");

  await page.getByRole("button", { name: "More destinations" }).tap();
  const settingsItem = page.getByRole("menuitem", { name: "Settings" });
  await expect(settingsItem).toBeVisible();
  await settingsItem.tap();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("keyboard reaches the skip link first", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
});

test("Logs route exposes only the registered-source explorer", async ({ page }) => {
  const sources = {
    observedAt: "2026-08-15T16:00:00.000Z",
    sources: [
      {
        sourceId: "systemd:docker",
        label: "Docker Engine",
        kind: "SYSTEMD",
        rangeMode: "TIME",
      },
    ],
  };
  const logs = {
    observedAt: "2026-08-15T16:00:00.000Z",
    source: sources.sources[0],
    range: "1h",
    rangeApplied: true,
    entries: [
      {
        sequence: 0,
        timestamp: "2026-08-15T15:59:00.000Z",
        level: "INFO",
        stream: "JOURNAL",
        message: "Docker health check completed",
      },
      {
        sequence: 1,
        timestamp: "2026-08-15T15:59:30.000Z",
        level: "WARN",
        stream: "JOURNAL",
        message: "Backup handoff waiting for evidence",
      },
    ],
    truncated: false,
  };

  await page.route("**/api/logs/sources", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sources) }),
  );
  await page.route("**/api/logs?*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(logs) }),
  );

  await page.goto("/logs");

  await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Source" })).toHaveValue("systemd:docker");
  await expect(page.getByText("Live · 2s visible refresh")).toBeVisible();
  await expect(page.getByText(/Paths, units and container selectors stay server-owned/i)).toBeVisible();

  await page.getByPlaceholder("Search logs").fill("backup");
  await expect(page.getByText("Backup handoff waiting for evidence")).toBeVisible();
  await expect(page.getByText("Docker health check completed")).toHaveCount(0);
});

test("Terminal route runs fixture Quick Commands without exposing a PTY", async ({ page }) => {
  await page.goto("/terminal");

  await expect(page.getByRole("heading", { name: "Terminal" })).toBeVisible();
  await expect(page.getByText("Full terminal locked.")).toBeVisible();
  await page.getByRole("button", { name: /Temperature \+ throttle/ }).click();
  await expect(page.getByText(/43°C · no throttle or under-voltage flags/)).toBeVisible();
});

test("Settings route documents loading stale unavailable and unknown states", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Checking current evidence")).toBeVisible();
  await expect(page.getByText("Last observation is old")).toBeVisible();
  await expect(page.getByText("Evidence source unavailable")).toBeVisible();
  await expect(page.getByText("No trustworthy evidence")).toBeVisible();
});
