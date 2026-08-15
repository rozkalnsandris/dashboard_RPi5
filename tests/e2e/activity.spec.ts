import { expect, test } from "@playwright/test";

const activityPayload = {
  observedAt: "2026-08-15T17:00:00.000Z",
  sources: [
    { source: "DOCKER", status: "AVAILABLE", observedAt: "2026-08-15T17:00:00.000Z" },
    { source: "SYSTEMD", status: "AVAILABLE", observedAt: "2026-08-15T17:00:00.000Z" },
    { source: "BACKUP", status: "AVAILABLE", observedAt: "2026-08-15T17:00:00.000Z" },
  ],
  items: [
    {
      id: `docker:${"a".repeat(64)}`,
      source: "DOCKER",
      severity: "CRITICAL",
      kind: "DOCKER_OOM",
      occurredAt: "2026-08-15T16:59:00.000Z",
      title: "homeassistant out of memory",
      detail: "image homeassistant/home-assistant:stable · scope local",
      target: "/docker",
      groupCount: 1,
    },
    {
      id: "backup:structured-success",
      source: "BACKUP",
      severity: "INFO",
      kind: "BACKUP_RESULT",
      occurredAt: "2026-08-15T16:58:30.000Z",
      title: "Backup completed",
      detail: "run 20260815T020000+0200 · duration 120s · size 123456 bytes · exit 0",
      target: "/backups",
      groupCount: 1,
    },
    {
      id: "systemd:ssh.service:2026-08-15T16:58:00.000Z:FAILED:failed",
      source: "SYSTEMD",
      severity: "CRITICAL",
      kind: "SYSTEMD_STATE",
      occurredAt: "2026-08-15T16:58:00.000Z",
      title: "SSH is failed",
      detail: "load loaded · state failed/failed · enablement enabled · restarts 1",
      target: "/services",
      groupCount: 1,
    },
    {
      id: `docker:${"b".repeat(64)}`,
      source: "DOCKER",
      severity: "INFO",
      kind: "DOCKER_START",
      occurredAt: "2026-08-15T16:57:00.000Z",
      title: "prometheus started",
      detail: "image prom/prometheus:latest · scope local",
      target: "/docker",
      groupCount: 2,
    },
  ],
};

test("Activity renders bounded live evidence without fixture categories or page overflow", async ({ page }) => {
  const requestedUrls: string[] = [];
  await page.route("**/api/activity", async (route) => {
    requestedUrls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(activityPayload),
    });
  });

  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.getByText("4 visible / 4 bounded events")).toBeVisible();
  await expect(page.getByText("homeassistant out of memory")).toBeVisible();
  await expect(page.getByText("Backup completed")).toBeVisible();
  await expect(page.getByText("SSH is failed")).toBeVisible();
  await expect(page.getByText("2 grouped events")).toBeVisible();
  await expect(page.getByText(/CV production SHA verified/i)).toHaveCount(0);
  await expect(page.getByText(/public endpoints remain reachable/i)).toHaveCount(0);
  await expect(page.getByText(/maintenance completed/i)).toHaveCount(0);

  expect(requestedUrls.length).toBeGreaterThan(0);
  for (const url of requestedUrls) {
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/activity");
    expect(parsed.search).toBe("");
  }

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("Activity source and severity filters stay client-side", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One desktop project covers filter semantics");
  let requests = 0;
  await page.route("**/api/activity", async (route) => {
    requests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(activityPayload),
    });
  });

  await page.goto("/activity");
  await expect(page.getByText("homeassistant out of memory")).toBeVisible();

  const beforeFilters = requests;
  await page.getByLabel("Activity source").selectOption("SYSTEMD");
  await expect(page.getByText("SSH is failed")).toBeVisible();
  await expect(page.getByText("homeassistant out of memory")).toHaveCount(0);
  expect(requests).toBe(beforeFilters);

  await page.getByLabel("Activity source").selectOption("BACKUP");
  await expect(page.getByText("Backup completed")).toBeVisible();
  await expect(page.getByText("SSH is failed")).toHaveCount(0);
  expect(requests).toBe(beforeFilters);

  await page.getByLabel("Activity source").selectOption("ALL");
  await page.getByLabel("Activity severity").selectOption("INFO");
  await expect(page.getByText("prometheus started")).toBeVisible();
  await expect(page.getByText("Backup completed")).toBeVisible();
  await expect(page.getByText("SSH is failed")).toHaveCount(0);
  expect(requests).toBe(beforeFilters);
});

test("Activity keeps partial source failure explicit without hiding valid evidence", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One desktop project covers degraded semantics");
  await page.route("**/api/activity", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...activityPayload,
        sources: [
          { source: "DOCKER", status: "UNAVAILABLE", observedAt: null },
          activityPayload.sources[1],
          { source: "BACKUP", status: "UNAVAILABLE", observedAt: null },
        ],
        items: [activityPayload.items[2]],
      }),
    }),
  );

  await page.goto("/activity");
  await expect(page.getByText("Activity is degraded")).toBeVisible();
  await expect(page.getByText(/Unavailable: Docker, Backups/)).toBeVisible();
  await expect(page.getByText("SSH is failed")).toBeVisible();
  await expect(page.getByText("Backup completed")).toHaveCount(0);
});

test("Activity complete source failure remains unavailable, not empty", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One desktop project covers unavailable semantics");
  await page.route("**/api/activity", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"SOURCE_UNAVAILABLE"}',
    }),
  );

  await page.goto("/activity");
  await expect(page.getByText("Activity evidence unavailable")).toBeVisible();
  await expect(page.getByText("Loading activity…")).toHaveCount(0);
});
