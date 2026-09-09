import { expect, test } from "@playwright/test";

const HISTORY_VALUES = [
  ["CPU_PERCENT", 24.6],
  ["CPU_USER_PERCENT", 18.4],
  ["CPU_SYSTEM_PERCENT", 5.1],
  ["CPU_IOWAIT_PERCENT", 1.1],
  ["MEMORY_PERCENT", 48.1],
  ["SWAP_PERCENT", 7.2],
  ["ROOT_FS_PERCENT", null],
  ["LOAD1", 0.42],
  ["SOC_TEMP_CELSIUS", 56.2],
  ["NVME_TEMP_CELSIUS", 49.9],
  ["FAN_RPM", 0],
  ["FAN_PWM_PERCENT", 0],
  ["NETWORK_RX_BYTES_PER_SECOND", 1_048_576],
  ["NETWORK_TX_BYTES_PER_SECOND", 262_144],
  ["DISK_READ_BYTES_PER_SECOND", 131_072],
  ["DISK_WRITE_BYTES_PER_SECOND", 65_536],
  ["UPTIME_SECONDS", 172_800],
] as const;

function historyPayload(range: string, grafana = true) {
  const observedAt = new Date().toISOString();
  const earlier = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  return {
    observedAt,
    range,
    windowStart: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    windowEnd: observedAt,
    series: HISTORY_VALUES.map(([metric, value]) => {
      if (value === null) return { metric, state: "UNAVAILABLE", points: [] };
      const previous = metric === "UPTIME_SECONDS" ? Math.max(0, value - 600) : value * 0.8;
      return {
        metric,
        state: "AVAILABLE",
        points: [
          { timestamp: earlier, value: previous },
          { timestamp: observedAt, value },
        ],
      };
    }),
    grafanaHref: grafana
      ? `https://grafana.example.test/d/rpi5/host?from=now-${range}&to=now`
      : null,
  };
}

test("Overview renders expanded host history without horizontal overflow", async ({ page }) => {
  await page.route("**/api/history/host?*", async (route) => {
    const range = new URL(route.request().url()).searchParams.get("range") ?? "24h";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(historyPayload(range)) });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Host trends" })).toBeVisible();
  await expect(page.locator("#history-group-cpu")).toHaveText("CPU");
  await expect(page.locator("#history-group-thermals-cooling")).toHaveText("Thermals & cooling");
  await expect(page.locator('[aria-label="CPU busy history"]').getByText("24.6%", { exact: true })).toBeVisible();
  await expect(page.locator('[aria-label="SoC temp history"]').getByText("56.2°C", { exact: true })).toBeVisible();
  await expect(page.locator('[aria-label="Network RX history"]').getByText("1.00 MiB/s", { exact: true })).toBeVisible();
  await expect(page.locator('[aria-label="Uptime history"]').getByText("2d", { exact: true })).toBeVisible();
  await expect(page.getByText("Root FS")).toBeVisible();
  await expect(page.getByText("No trustworthy samples in this window.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Open in Grafana/ })).toHaveAttribute(
    "href",
    "https://grafana.example.test/d/rpi5/host?from=now-24h&to=now",
  );

  const rangeButtonHeight = await page.getByRole("button", { name: "24h" }).evaluate(
    (button) => button.getBoundingClientRect().height,
  );
  expect(rangeButtonHeight).toBeGreaterThanOrEqual(48);

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
  await expect(page.locator('[aria-label="CPU busy history"]').getByText("24.6%", { exact: true })).toBeVisible();
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
