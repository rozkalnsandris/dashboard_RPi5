import { expect, test } from "@playwright/test";

const activityPayload = {
  observedAt: "2026-08-15T17:00:00.000Z",
  sources: [
    { source: "DOCKER", status: "AVAILABLE", observedAt: "2026-08-15T17:00:00.000Z" },
    { source: "SYSTEMD", status: "AVAILABLE", observedAt: "2026-08-15T17:00:00.000Z" },
    { source: "BACKUP", status: "AVAILABLE", observedAt: "2026-08-15T17:00:00.000Z" },
    { source: "MAINTENANCE", status: "AVAILABLE", observedAt: "2026-08-15T17:00:00.000Z" },
    { source: "DEPLOY", status: "AVAILABLE", observedAt: "2026-08-15T17:00:00.000Z" },
    { source: "ENDPOINT", status: "AVAILABLE", observedAt: "2026-08-15T17:00:00.000Z" },
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
      id: "endpoint:tech-down-20260815T165855Z",
      source: "ENDPOINT",
      severity: "CRITICAL",
      kind: "ENDPOINT_STATE",
      occurredAt: "2026-08-15T16:58:55.000Z",
      title: "Hermes Tech is down",
      detail: "endpoint tech · up → down · status 503 · latency 1500ms",
      target: "/",
      groupCount: 1,
    },
    {
      id: "deploy:verified-success",
      source: "DEPLOY",
      severity: "INFO",
      kind: "DEPLOY_VERIFIED",
      occurredAt: "2026-08-15T16:58:50.000Z",
      title: "Deploy verified",
      detail: "commit abcdef123456 · transaction 20260815T165850000000Z-abcdef123456",
      target: "/logs",
      groupCount: 1,
    },
    {
      id: "maintenance:structured-success",
      source: "MAINTENANCE",
      severity: "INFO",
      kind: "MAINTENANCE_RESULT",
      occurredAt: "2026-08-15T16:58:45.000Z",
      title: "Maintenance completed",
      detail: "invocation 0123456789abcdef0123456789abcdef · systemd result success",
      target: "/logs",
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

test("Activity renders bounded live evidence including normalized endpoint transitions without page overflow", async ({ page }) => {
  const requestedUrls: string[] = [];
  await page.route("**/api/activity", async (route) => {
    requestedUrls.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(activityPayload) });
  });

  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.getByText("7 shown / 7 matching · 7 bounded events")).toBeVisible();
  await expect(page.getByText("homeassistant out of memory")).toBeVisible();
  await expect(page.getByText("Hermes Tech is down")).toBeVisible();
  await expect(page.getByText("Deploy verified")).toBeVisible();
  await expect(page.getByText("Maintenance completed")).toBeVisible();
  await expect(page.getByText("Backup completed")).toBeVisible();
  await expect(page.getByText("SSH is failed")).toBeVisible();
  await expect(page.getByText("2 grouped events")).toBeVisible();
  await expect(page.getByText(/public endpoints remain reachable/i)).toHaveCount(0);
  await expect(page.getByText(/deploy failed/i)).toHaveCount(0);
  await expect(page.getByText(/https:\/\//i)).toHaveCount(0);

  expect(requestedUrls.length).toBeGreaterThan(0);
  for (const url of requestedUrls) {
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/activity");
    expect(parsed.search).toBe("");
  }

  const endpointLink = page.getByRole("link", { name: "Open Endpoints" });
  await expect(endpointLink).toHaveAttribute("href", "/");

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
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(activityPayload) });
  });

  await page.goto("/activity");
  await expect(page.getByText("homeassistant out of memory")).toBeVisible();
  const beforeFilters = requests;

  await page.getByLabel("Activity source").selectOption("ENDPOINT");
  await expect(page.getByText("Hermes Tech is down")).toBeVisible();
  await expect(page.getByText("Deploy verified")).toHaveCount(0);
  expect(requests).toBe(beforeFilters);

  await page.getByLabel("Activity source").selectOption("DEPLOY");
  await expect(page.getByText("Deploy verified")).toBeVisible();
  await expect(page.getByText("Hermes Tech is down")).toHaveCount(0);
  expect(requests).toBe(beforeFilters);

  await page.getByLabel("Activity source").selectOption("SYSTEMD");
  await expect(page.getByText("SSH is failed")).toBeVisible();
  await expect(page.getByText("Deploy verified")).toHaveCount(0);
  expect(requests).toBe(beforeFilters);

  await page.getByLabel("Activity source").selectOption("BACKUP");
  await expect(page.getByText("Backup completed")).toBeVisible();
  expect(requests).toBe(beforeFilters);

  await page.getByLabel("Activity source").selectOption("MAINTENANCE");
  await expect(page.getByText("Maintenance completed")).toBeVisible();
  expect(requests).toBe(beforeFilters);

  await page.getByLabel("Activity source").selectOption("ALL");
  await page.getByLabel("Activity severity").selectOption("INFO");
  await expect(page.getByText("prometheus started")).toBeVisible();
  await expect(page.getByText("Backup completed")).toBeVisible();
  await expect(page.getByText("Maintenance completed")).toBeVisible();
  await expect(page.getByText("Deploy verified")).toBeVisible();
  await expect(page.getByText("Hermes Tech is down")).toHaveCount(0);
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
          activityPayload.sources[3],
          activityPayload.sources[4],
          { source: "ENDPOINT", status: "UNAVAILABLE", observedAt: null },
        ],
        items: [activityPayload.items[2], activityPayload.items[3], activityPayload.items[5]],
      }),
    }),
  );

  await page.goto("/activity");
  await expect(page.getByText("Activity is degraded")).toBeVisible();
  await expect(page.getByText(/Unavailable: Docker, Backups, Endpoints/)).toBeVisible();
  await expect(page.getByText("Deploy verified")).toBeVisible();
  await expect(page.getByText("Maintenance completed")).toBeVisible();
  await expect(page.getByText("SSH is failed")).toBeVisible();
  await expect(page.getByText("Backup completed")).toHaveCount(0);
  await expect(page.getByText("Hermes Tech is down")).toHaveCount(0);
});

test("Activity complete source failure remains unavailable, not empty", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One desktop project covers unavailable semantics");
  await page.route("**/api/activity", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"SOURCE_UNAVAILABLE"}' }),
  );

  await page.goto("/activity");
  await expect(page.getByText("Activity evidence unavailable")).toBeVisible();
  await expect(page.getByText("Loading activity…")).toHaveCount(0);
});

test("Activity initially renders 20 of 55 events, expands on demand and resets after filter changes", async ({ page }) => {
  const newest = Date.parse("2026-08-15T16:59:00.000Z");
  const items = Array.from({ length: 55 }, (_, index) => ({
    ...activityPayload.items[0]!,
    id: `docker:activity-${String(index).padStart(3, "0")}`,
    occurredAt: new Date(newest - index * 1_000).toISOString(),
    severity: index % 2 === 0 ? "CRITICAL" : "INFO",
    title: `activity event ${index + 1}`,
  }));
  await page.route("**/api/activity", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...activityPayload, items }),
    }),
  );

  await page.goto("/activity");
  const rows = page.locator(".activity-timeline--live > li");
  await expect(rows).toHaveCount(20);
  await expect(page.getByText("20 shown / 55 matching · 55 bounded events")).toBeVisible();
  await expect(page.getByText("activity event 20", { exact: true })).toBeVisible();
  await expect(page.getByText("activity event 21", { exact: true })).toHaveCount(0);

  const more20 = page.getByRole("button", { name: "Show 20 more events" });
  await expect(more20).toBeVisible();
  expect(await more20.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
  await more20.click();
  await expect(rows).toHaveCount(40);
  await expect(page.getByText("40 shown / 55 matching · 55 bounded events")).toBeVisible();

  await page.getByRole("button", { name: "Show 15 more events" }).click();
  await expect(rows).toHaveCount(55);
  await expect(page.getByText("activity event 55", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /show \d+ more events/i })).toHaveCount(0);

  await page.getByLabel("Activity severity").selectOption("INFO");
  await expect(rows).toHaveCount(20);
  await expect(page.getByText("20 shown / 27 matching · 55 bounded events")).toBeVisible();
  await page.getByRole("button", { name: "Show 7 more events" }).click();
  await expect(rows).toHaveCount(27);

  await page.getByLabel("Activity severity").selectOption("ALL");
  await expect(rows).toHaveCount(20);
  await expect(page.getByText("20 shown / 55 matching · 55 bounded events")).toBeVisible();

  await page.getByLabel("Activity source").selectOption("SYSTEMD");
  await expect(rows).toHaveCount(0);
  await expect(page.getByText("0 shown / 0 matching · 55 bounded events")).toBeVisible();
  await expect(page.getByRole("button", { name: /show \d+ more events/i })).toHaveCount(0);

  await page.getByLabel("Activity source").selectOption("ALL");
  await expect(rows).toHaveCount(20);
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
