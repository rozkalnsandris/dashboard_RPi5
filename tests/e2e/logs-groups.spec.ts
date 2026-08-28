import { expect, test } from "@playwright/test";

const sources = [
  { sourceId: "docker:homeassistant", label: "Home Assistant", kind: "DOCKER", rangeMode: "TIME" },
  { sourceId: "systemd:cloudflared", label: "Cloudflared", kind: "SYSTEMD", rangeMode: "TIME" },
  { sourceId: "journal:rpi5-deploy", label: "RPi5 deploy", kind: "JOURNAL", rangeMode: "TIME" },
  { sourceId: "file:rpi5-backup", label: "RPi5 backup", kind: "FILE", rangeMode: "TAIL" },
];

test("Logs groups the bounded source allowlist by backend kind", async ({ page }) => {
  await page.route("**/api/logs/sources", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ observedAt: "2026-08-28T08:00:00.000Z", sources }),
  }));
  await page.route("**/api/logs?*", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      observedAt: "2026-08-28T08:00:00.000Z", source: sources[0], range: "1h",
      rangeApplied: true, entries: [], truncated: false,
    }),
  }));
  await page.goto("/logs");
  const sourceSelect = page.getByLabel("Source");
  await expect(sourceSelect.locator('optgroup[label="Docker"]')).toHaveCount(1);
  await expect(sourceSelect.locator('optgroup[label="Systemd"]')).toHaveCount(1);
  await expect(sourceSelect.locator('optgroup[label="Journal"]')).toHaveCount(1);
  await expect(sourceSelect.locator('optgroup[label="Files"]')).toHaveCount(1);
  await expect(sourceSelect.getByRole("option", { name: "Cloudflared" })).toHaveCount(1);
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});
