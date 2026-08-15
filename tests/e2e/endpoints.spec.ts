import { expect, test } from "@playwright/test";

const up = {
  endpointId: "tech",
  label: "Hermes Tech",
  state: "UP",
  lastChangedAt: "2026-08-15T20:00:00.000Z",
  statusCode: 200,
  latencyMs: 84,
};

const down = {
  endpointId: "grafana",
  label: "Grafana",
  state: "DOWN",
  lastChangedAt: "2026-08-15T20:05:00.000Z",
  statusCode: 502,
  latencyMs: 1_240,
};

const healthyPayload = {
  observedAt: "2026-08-15T20:10:00.000Z",
  health: "HEALTHY",
  endpoints: [up],
};

const attentionPayload = {
  observedAt: "2026-08-15T20:10:00.000Z",
  health: "ATTENTION",
  endpoints: [down, up],
};

const emptyPayload = {
  observedAt: "2026-08-15T20:10:00.000Z",
  health: "UNKNOWN",
  endpoints: [],
};

test("Overview renders bounded healthy public endpoints without selectors, secrets or overflow", async ({ page }) => {
  const requestedUrls: string[] = [];
  await page.route("**/api/endpoints", async (route) => {
    requestedUrls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(healthyPayload),
    });
  });

  await page.goto("/");
  await expect(page.getByText("Public endpoints healthy", { exact: true })).toBeVisible();
  await expect(page.getByText("Hermes Tech", { exact: true })).toBeVisible();
  await expect(page.getByText("Up", { exact: true })).toBeVisible();
  await expect(page.getByText("HTTP 200 · 84 ms", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open endpoint activity/ })).toHaveAttribute("href", "/activity");

  expect(requestedUrls.length).toBeGreaterThan(0);
  expect(
    requestedUrls.every((url) => {
      const parsed = new URL(url);
      return parsed.pathname === "/api/endpoints" && parsed.search === "";
    }),
  ).toBe(true);

  const pageText = await page.locator("body").innerText();
  for (const forbidden of [
    "https://",
    "http://",
    "/var/lib/dashboard-rpi5",
    "Authorization",
    "Cookie",
    "monitorId",
    "probe URL",
  ]) {
    expect(pageText).not.toContain(forbidden);
  }

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("Overview surfaces endpoint outage as needs attention", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One project covers outage semantics");
  await page.route("**/api/endpoints", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(attentionPayload) }),
  );

  await page.goto("/");
  await expect(page.getByText("Public endpoints need attention", { exact: true })).toBeVisible();
  await expect(page.getByText("1 endpoint currently down or degraded.", { exact: true })).toBeVisible();
  await expect(page.getByText("Grafana", { exact: true })).toBeVisible();
  await expect(page.getByText("Down", { exact: true })).toBeVisible();
  await expect(page.getByText("All clear", { exact: true })).toBeHidden();
});

test("Overview keeps unavailable endpoint source unknown instead of all-clear", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One project covers unavailable semantics");
  await page.route("**/api/endpoints", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"SOURCE_UNAVAILABLE"}' }),
  );

  await page.goto("/");
  await expect(page.getByText("Public endpoint evidence unknown", { exact: true })).toBeVisible();
  await expect(page.getByText("The structured endpoint source is unavailable; this is not treated as all-clear.", { exact: true })).toBeVisible();
  await expect(page.getByText("All clear", { exact: true })).toBeHidden();
});

test("Overview keeps an empty structured endpoint window unknown", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One project covers empty semantics");
  await page.route("**/api/endpoints", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(emptyPayload) }),
  );

  await page.goto("/");
  await expect(page.getByText("Public endpoint evidence unknown", { exact: true })).toBeVisible();
  await expect(page.getByText(/No current endpoint state is present/)).toBeVisible();
});
