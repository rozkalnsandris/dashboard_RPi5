import { expect, test } from "@playwright/test";

function servicesPayload(observedAt = new Date().toISOString()) {
  return {
    observedAt,
    services: [
      {
        unitId: "dashboard-rpi5-agent.service",
        label: "Dashboard agent",
        loadState: "NOT_FOUND",
        activeState: "INACTIVE",
        subState: "dead",
        enablement: "UNKNOWN",
        restartCount: null,
        stateAgeSeconds: null,
      },
      {
        unitId: "docker.service",
        label: "Docker Engine",
        loadState: "LOADED",
        activeState: "ACTIVE",
        subState: "running",
        enablement: "ENABLED",
        restartCount: 1,
        stateAgeSeconds: 7_200,
      },
      {
        unitId: "ssh.service",
        label: "SSH",
        loadState: "LOADED",
        activeState: "ACTIVATING",
        subState: "start",
        enablement: "ENABLED",
        restartCount: 0,
        stateAgeSeconds: 4,
      },
      {
        unitId: "cron.service",
        label: "Cron scheduler",
        loadState: "LOADED",
        activeState: "FAILED",
        subState: "failed",
        enablement: "ENABLED",
        restartCount: 3,
        stateAgeSeconds: 90,
      },
    ],
  };
}

test("Services renders allowlisted evidence without horizontal overflow", async ({ page }) => {
  const requestedUrls: string[] = [];
  await page.route("**/api/services", async (route) => {
    requestedUrls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(servicesPayload()),
    });
  });

  await page.goto("/services");
  await expect(page.getByRole("heading", { name: "Services" })).toBeVisible();
  await expect(page.getByText("Docker Engine").first()).toBeVisible();
  await expect(page.getByText("Dashboard agent").first()).toBeVisible();
  await expect(page.getByText("Healthy").first()).toBeVisible();
  await expect(page.getByText("Critical").first()).toBeVisible();
  await expect(page.getByText("Unknown").first()).toBeVisible();
  expect(requestedUrls.every((url) => new URL(url).search === "")).toBe(true);

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("Services keeps source failure explicit", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One project is enough for the normalized error state");
  await page.route("**/api/services", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"SOURCE_UNAVAILABLE"}' }),
  );

  await page.goto("/services");
  await expect(page.getByText("Service evidence unavailable")).toBeVisible();
  await expect(page.getByText(/No service is shown as healthy/)).toBeVisible();
});

test("Services labels stale evidence instead of silently treating it as current", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One project is enough for stale-state semantics");
  await page.route("**/api/services", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(servicesPayload(new Date(Date.now() - 5 * 60_000).toISOString())),
    }),
  );

  await page.goto("/services");
  await expect(page.getByText("Service evidence is stale")).toBeVisible();
  await expect(page.getByText(/last trustworthy snapshot/)).toBeVisible();
});
