import { expect, test, type Page } from "@playwright/test";

const sourcesPayload = {
  observedAt: "2026-08-15T16:00:00.000Z",
  sources: [
    { sourceId: "systemd:docker", label: "Docker Engine", kind: "SYSTEMD", rangeMode: "TIME" },
    { sourceId: "file:rpi5-backup", label: "RPi5 backup", kind: "FILE", rangeMode: "TAIL" },
  ],
};

function logsPayload(message = "Docker daemon ready") {
  return {
    observedAt: new Date().toISOString(),
    source: sourcesPayload.sources[0],
    range: "1h",
    rangeApplied: true,
    entries: [
      {
        sequence: 0,
        timestamp: "2026-08-15T15:59:00.000Z",
        level: "INFO",
        stream: "JOURNAL",
        message,
      },
      {
        sequence: 1,
        timestamp: "2026-08-15T15:59:30.000Z",
        level: "WARN",
        stream: "JOURNAL",
        message: "Retry budget approaching threshold",
      },
    ],
    truncated: false,
  };
}

async function mockLogs(page: Page) {
  const requestedUrls: string[] = [];
  await page.route("**/api/logs/sources", async (route) => {
    requestedUrls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sourcesPayload),
    });
  });
  await page.route("**/api/logs?*", async (route) => {
    requestedUrls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(logsPayload("<script>window.__logXss = true</script>")),
    });
  });
  return requestedUrls;
}

test("Logs renders bounded registered-source evidence without horizontal page overflow", async ({ page }) => {
  const requestedUrls = await mockLogs(page);
  await page.goto("/logs");

  await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();
  await expect(page.getByLabel("Source")).toHaveValue("systemd:docker");
  await expect(page.getByText("2 visible / 2 bounded lines")).toBeVisible();
  await expect(page.getByText("<script>window.__logXss = true</script>", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __logXss?: boolean }).__logXss)).toBeUndefined();

  const urls = requestedUrls.map((url) => new URL(url));
  expect(urls.some((url) => url.pathname === "/api/logs/sources" && url.search === "")).toBe(true);
  expect(
    urls.some(
      (url) =>
        url.pathname === "/api/logs" &&
        url.searchParams.get("sourceId") === "systemd:docker" &&
        url.searchParams.get("range") === "1h" &&
        [...url.searchParams.keys()].every((key) => key === "sourceId" || key === "range"),
    ),
  ).toBe(true);

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("Logs search, pause and wrap controls keep the bounded snapshot local", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One desktop project is enough for interaction semantics");
  let logsRequests = 0;
  await page.route("**/api/logs/sources", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sourcesPayload) }),
  );
  await page.route("**/api/logs?*", (route) => {
    logsRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(logsPayload()),
    });
  });

  await page.goto("/logs");
  await expect(page.getByText("Docker daemon ready")).toBeVisible();

  await page.getByPlaceholder("Search logs").fill("retry budget");
  await expect(page.getByText("Retry budget approaching threshold")).toBeVisible();
  await expect(page.getByText("Docker daemon ready")).toBeHidden();

  await page.getByRole("button", { name: "Wrap on" }).click();
  await expect(page.getByRole("button", { name: "Wrap off" })).toBeVisible();

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("Paused · snapshot frozen")).toBeVisible();
  const pausedAt = logsRequests;
  await page.waitForTimeout(2_250);
  expect(logsRequests).toBe(pausedAt);
});

test("Logs source failure remains explicit", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One project is enough for the normalized error state");
  await page.route("**/api/logs/sources", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"SOURCE_UNAVAILABLE"}' }),
  );
  await page.goto("/logs");
  await expect(page.getByText("Log evidence unavailable")).toBeVisible();
  await expect(page.getByText(/No missing source is represented as an empty healthy stream/)).toBeVisible();
  await expect(page.getByText("Loading registered logs…")).toHaveCount(0);
});
