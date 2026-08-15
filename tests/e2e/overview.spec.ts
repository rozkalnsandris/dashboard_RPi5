import { expect, test } from "@playwright/test";

test("overview renders the fixture health shell without page overflow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Raspberry Pi 5" })).toBeVisible();
  await expect(page.getByText("Needs attention")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Docker" })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("Logs route exposes only the fixture registered-source explorer", async ({ page }) => {
  await page.goto("/logs");

  await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();
  await expect(page.getByLabel("Source")).toHaveValue("all");
  await expect(page.getByText("Fixture follow active")).toBeVisible();
  await expect(page.getByText(/browser cannot provide a filesystem path/i)).toBeVisible();

  await page.getByLabel("Search").fill("backup");
  await expect(page.getByText(/Last fixture backup evidence remains fresh/)).toBeVisible();
  await expect(page.getByText(/Health check completed/)).toHaveCount(0);
});

test("Terminal route runs fixture Quick Commands without exposing a PTY", async ({ page }) => {
  await page.goto("/terminal");

  await expect(page.getByRole("heading", { name: "Terminal" })).toBeVisible();
  await expect(page.getByText("Full terminal locked.")).toBeVisible();
  await page.getByRole("button", { name: /Temperature \+ throttle/ }).click();
  await expect(page.getByText(/43°C · no throttle or under-voltage flags/)).toBeVisible();
});
