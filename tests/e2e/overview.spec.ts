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

test("mobile More menu performs client-side route navigation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop-1440", "Mobile overflow menu is not rendered in the desktop shell");
  await page.goto("/");

  await page.getByRole("button", { name: "More destinations" }).click();
  await expect(page.getByRole("menu", { name: "More dashboard destinations" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Settings" }).click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("keyboard reaches the skip link first", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
});

test("Logs route exposes only the fixture registered-source explorer", async ({ page }) => {
  await page.goto("/logs");

  await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Source" })).toHaveValue("all");
  await expect(page.getByText("Fixture follow active")).toBeVisible();
  await expect(page.getByText(/browser cannot provide a filesystem path/i)).toBeVisible();

  await page.getByRole("textbox", { name: "Search" }).fill("backup");
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

test("Settings route documents loading stale unavailable and unknown states", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Checking current evidence")).toBeVisible();
  await expect(page.getByText("Last observation is old")).toBeVisible();
  await expect(page.getByText("Evidence source unavailable")).toBeVisible();
  await expect(page.getByText("No trustworthy evidence")).toBeVisible();
});
