import { expect, test } from "@playwright/test";

const hostPayload = {
  observedAt: "2099-08-17T18:00:00.000Z",
  uptimeSeconds: 321_000,
  loadAverage: { oneMinute: 0.42, fiveMinutes: 0.37, fifteenMinutes: 0.31 },
  cpu: { usagePercent: 12.5, sampleWindowMs: 200 },
  memory: {
    totalBytes: 8_589_934_592,
    availableBytes: 5_368_709_120,
    usedBytes: 3_221_225_472,
    usedPercent: 37.5,
    swapTotalBytes: 0,
    swapFreeBytes: 0,
    swapUsedBytes: 0,
    swapUsedPercent: null,
  },
  filesystem: {
    path: "/",
    totalBytes: 256_000_000_000,
    availableBytes: 151_000_000_000,
    usedBytes: 105_000_000_000,
    usedPercent: 41,
  },
  temperature: { celsius: 43.2 },
  throttle: { state: "UNAVAILABLE" },
};

const dockerPayload = {
  observedAt: "2099-08-17T18:00:00.000Z",
  apiVersion: "1.40",
  engineVersion: "28.3.3",
  daemonApiVersion: "1.51",
  daemonMinApiVersion: "1.24",
  containers: [],
};

test("overview keeps live host metrics while throttle firmware evidence is unavailable", async ({ page }) => {
  await page.route("**/api/current/host", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(hostPayload) }),
  );
  await page.route("**/api/current/docker", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dockerPayload) }),
  );

  await page.goto("/");

  await expect(page.getByText("43°C", { exact: true })).toBeVisible();
  await expect(page.getByText("Firmware throttle evidence unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("All clear", { exact: true })).toHaveCount(0);

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
