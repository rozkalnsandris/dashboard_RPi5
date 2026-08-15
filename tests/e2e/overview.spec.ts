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

test("primary navigation reaches the fixture Logs route", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Logs" }).first().click();
  await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();
  await expect(page.getByText(/No log source is connected yet/)).toBeVisible();
});
