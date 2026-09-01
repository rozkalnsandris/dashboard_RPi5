import { expect, test } from "@playwright/test";

test("document title follows client-side dashboard navigation", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Overview · dashboard_RPi5");

  const navigation = testInfo.project.name === "desktop-1440"
    ? page.getByRole("navigation", { name: "Dashboard navigation" })
    : page.getByRole("navigation", { name: "Primary navigation" });

  await navigation.getByRole("link", { name: "Docker" }).click();

  await expect(page).toHaveURL(/\/docker$/);
  await expect(page).toHaveTitle("Docker · dashboard_RPi5");
});
