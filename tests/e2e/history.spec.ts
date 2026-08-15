import { expect, test } from "@playwright/test";

function historyPayload(range: string, grafana = true) {
  const observedAt = new Date().toISOString();
  return {
    observedAt,
    range,
    windowStart: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    windowEnd: observedAt,
    series: [
      {
        metric: "CPU_PERCENT",
        state: "AVAILABLE",
        points: [
          { timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(), value: 18.2 },
          { timestamp: observedAt, value: 24.6 },
        ],
      },
      {
        metric: "MEMORY_PERCENT",
        state: "AVAILABLE",
        points: [
          { timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(), value: 46.4 },
          { timestamp: observedAt, value: 48.1 },
        ],
      },
      { metric: "ROOT_FS_PERCENT", state: "UNAVAILABLE", points: [] },
      {
        metric: "LOAD1",
        state: "AVAILABLE",
        points: [
          { timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(), value: 0.31 },
          { timestamp: observedAt, value: 0.42 },
        ],
      },
    ],
    grafanaHref: grafana
      ? `https://grafana.example.test/d/rpi5/host?from=now-${range}&to=now`
      : null,
  };
}

test("Overview renders bounded host history without horizontal overflow", async ({ page }) => {
  await page.route("**/api/history/host?*", async (route) => {
    const range = new URL(route.request().url()).searchParams.get("range") ?? "24h";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(historyPayload(range)) });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Host trends" })).toBeVisible();
  await expect(page.getByText("24.6%", { exact: true })).toBeVisible();
  await expect(page.getByText("Root FS")).toBeVisible();
  await expect(page.getByText("No trustworthy samples in this window.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Open in Grafana/ })).toHaveAttribute(
    "href",
    "https://grafana.example.test/d/rpi5/host?from=now-24h&to=now",
  );

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("history range control requests preset ranges only and handles a missing Grafana link", async ({ page }) => {
  const ranges: string[] = [];
  await page.route("**/api/history/host?*", async (route) => {
    const range = new URL(route.request().url()).searchParams.get("range") ?? "24h";
    ranges.push(range);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(historyPayload(range, range !== "7d")),
    });
  });

  await page.goto("/");
  await expect(page.getByText("24.6%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "1h" }).click();
  await expect.poll(() => ranges.at(-1)).toBe("1h");
  await page.getByRole("button", { name: "7d" }).click();
  await expect.poll(() => ranges.at(-1)).toBe("7d");
  await expect(page.getByText("Grafana link not configured")).toBeVisible();
  expect(ranges.every((range) => range === "1h" || range === "24h" || range === "7d")).toBe(true);
});

test("history source failure stays explicit instead of showing fake values", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One project is enough for the normalized error-state assertion");
  await page.route("**/api/history/host?*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"SOURCE_UNAVAILABLE"}' }));

  await page.goto("/");
  await expect(page.getByText("History unavailable")).toBeVisible();
  await expect(page.getByText(/No cached values are substituted/)).toBeVisible();
});
