import { expect, test } from "@playwright/test";

const catalog = {
  commands: [
    { id: "host.uptime", label: "Uptime", description: "Human-readable host uptime" },
    { id: "host.kernel", label: "Kernel", description: "Kernel release and machine architecture" },
    { id: "host.disk-root", label: "Root disk usage", description: "Bounded root filesystem usage summary" },
    { id: "host.failed-units", label: "Failed services", description: "Systemd units currently in failed state" },
  ],
};

function result(commandId = "host.kernel") {
  return {
    commandId,
    status: "SUCCESS",
    startedAt: "2026-08-15T20:00:00.000Z",
    finishedAt: "2026-08-15T20:00:00.012Z",
    durationMs: 12,
    exitCode: 0,
    stdout: "Linux 6.12.93+rpt-rpi-2712 aarch64 GNU/Linux",
    stderr: "",
  };
}

test("Terminal runs only registered Quick Commands without exposing shell controls", async ({ page }) => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  await page.route("**/api/quick-commands/run", async (route) => {
    requests.push({
      url: route.request().url(),
      method: route.request().method(),
      body: route.request().postDataJSON(),
    });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result()) });
  });
  await page.route("**/api/quick-commands", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalog) }),
  );

  await page.goto("/terminal");
  await expect(page.getByRole("heading", { name: "Terminal" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Kernel/ })).toBeVisible();
  await expect(page.getByText(/Full terminal locked/)).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByText(/fixture only/i)).toHaveCount(0);

  await page.getByRole("button", { name: /Kernel/ }).click();
  await expect(page.locator(".terminal-output")).toContainText("Linux 6.12.93+rpt-rpi-2712");
  await expect(page.locator(".quick-command-meta")).toContainText("SUCCESS");
  expect(requests).toEqual([
    {
      url: expect.stringMatching(/\/api\/quick-commands\/run$/),
      method: "POST",
      body: { commandId: "host.kernel" },
    },
  ]);
  expect((await page.locator("body").innerText())).not.toMatch(/\/usr\/bin|sudo|docker exec|shell=true/i);

  for (const button of await page.locator(".quick-command").all()) {
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  }
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("Terminal keeps timeout explicit", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One project is enough for timeout semantics");
  await page.route("**/api/quick-commands/run", (route) =>
    route.fulfill({ status: 504, contentType: "application/json", body: '{"error":"OPERATION_TIMEOUT"}' }),
  );
  await page.route("**/api/quick-commands", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalog) }),
  );

  await page.goto("/terminal");
  await page.getByRole("button", { name: /Uptime/ }).click();
  await expect(page.locator(".terminal-output")).toContainText("timed out");
  await expect(page.locator(".terminal-output")).toContainText("bounded result");
});
