import { expect, test, type Page } from "@playwright/test";

const TOKEN_A = "a".repeat(64);
const catalog = {
  commands: [
    { id: "host.uptime", label: "Uptime", description: "Human-readable host uptime" },
    { id: "host.kernel", label: "Kernel", description: "Kernel release and machine architecture" },
  ],
};

async function installQuickCommandCatalog(page: Page) {
  await page.route("**/api/quick-commands", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalog) }),
  );
}

function resizeFrameCount(messages: readonly string[]): number {
  return messages.filter((message) => {
    const parsed = JSON.parse(message) as Record<string, unknown>;
    return parsed.type === "resize";
  }).length;
}

test("full terminal requires explicit start, keeps capability out of DOM/storage and translates xterm input", async ({ page }, testInfo) => {
  test.skip(!["desktop-1440", "a55-class"].includes(testInfo.project.name), "Focused terminal transport acceptance");
  await installQuickCommandCatalog(page);

  const sessionRequests: unknown[] = [];
  await page.route("**/api/terminal/session", async (route) => {
    sessionRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        sessionToken: TOKEN_A,
        idleTimeoutMs: 300_000,
        maxLifetimeMs: 1_800_000,
      }),
    });
  });

  const clientFrames: string[] = [];
  let sendServer: ((message: string) => void) | undefined;
  let socketOpened = false;
  await page.routeWebSocket("**/api/terminal/ws", (ws) => {
    socketOpened = true;
    sendServer = (message) => ws.send(message);
    ws.onMessage((message) => {
      if (typeof message === "string") clientFrames.push(message);
    });
    setTimeout(() => ws.send('{"type":"ready"}'), 20);
  });

  await page.goto("/terminal");
  await expect(page.getByText("Full terminal locked.")).toBeVisible();
  await expect(page.locator(".xterm")).toHaveCount(0);
  expect(sessionRequests).toEqual([]);
  expect(socketOpened).toBe(false);

  await page.getByRole("button", { name: "Start terminal" }).click();
  await expect(page.locator(".terminal-session-state")).toHaveText("Connected");
  await expect(page.locator(".xterm")).toHaveCount(1);
  expect(sessionRequests).toEqual([{}]);
  expect(socketOpened).toBe(true);

  expect(page.url()).not.toContain(TOKEN_A);
  expect(await page.locator("body").innerText()).not.toContain(TOKEN_A);
  const storageDump = await page.evaluate(() => JSON.stringify({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));
  expect(storageDump).not.toContain(TOKEN_A);

  sendServer?.('{"type":"output","data":"hello-from-rpi5\\r\\n"}');
  await expect(page.locator(".xterm-rows")).toContainText("hello-from-rpi5");

  await page.getByRole("button", { name: "Open keyboard" }).click();
  await page.keyboard.type("pwd");
  await page.keyboard.press("Enter");
  await expect.poll(() => clientFrames.length).toBeGreaterThan(0);

  const joinedInput = clientFrames.flatMap((frame) => {
    const parsed = JSON.parse(frame) as Record<string, unknown>;
    return parsed.type === "input" && typeof parsed.data === "string" ? [parsed.data] : [];
  }).join("");
  expect(joinedInput).toContain("pwd");
  expect(joinedInput).toContain("\r");
  expect(resizeFrameCount(clientFrames)).toBeGreaterThan(0);
});

test("A55 terminal controls remain touch-sized and refit after a mobile viewport-height change", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "a55-class", "Samsung A55 primary acceptance target");
  await installQuickCommandCatalog(page);
  await page.route("**/api/terminal/session", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({
      sessionToken: TOKEN_A,
      idleTimeoutMs: 300_000,
      maxLifetimeMs: 1_800_000,
    }),
  }));

  const clientFrames: string[] = [];
  await page.routeWebSocket("**/api/terminal/ws", (ws) => {
    ws.onMessage((message) => {
      if (typeof message === "string") clientFrames.push(message);
    });
    setTimeout(() => ws.send('{"type":"ready"}'), 20);
  });

  await page.goto("/terminal");
  const start = page.getByRole("button", { name: "Start terminal" });
  const startBox = await start.boundingBox();
  expect(startBox?.height ?? 0).toBeGreaterThanOrEqual(48);
  await start.click();
  await expect(page.locator(".terminal-session-state")).toHaveText("Connected");

  for (const label of ["Open keyboard", "Disconnect"]) {
    const box = await page.getByRole("button", { name: label }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  }

  await page.getByRole("button", { name: "Open keyboard" }).click();
  await expect(page.locator(".xterm-helper-textarea")).toBeFocused();

  const frame = page.locator(".full-terminal-frame");
  const initialBox = await frame.boundingBox();
  expect(initialBox?.width ?? 9999).toBeLessThanOrEqual(412);
  expect(initialBox?.height ?? 0).toBeGreaterThanOrEqual(280);

  const resizeCountBefore = resizeFrameCount(clientFrames);
  await page.setViewportSize({ width: 412, height: 640 });
  await expect.poll(() => resizeFrameCount(clientFrames)).toBeGreaterThan(resizeCountBefore);

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
  const resizedBox = await frame.boundingBox();
  expect(resizedBox?.width ?? 9999).toBeLessThanOrEqual(412);
  expect(resizedBox?.height ?? 0).toBeGreaterThanOrEqual(280);
});

test("disabled host fails closed before xterm or websocket creation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One project is enough for admission failure semantics");
  await installQuickCommandCatalog(page);
  await page.route("**/api/terminal/session", (route) => route.fulfill({
    status: 404,
    contentType: "application/json",
    body: '{"error":"TERMINAL_UNAVAILABLE"}',
  }));
  let socketOpened = false;
  await page.routeWebSocket("**/api/terminal/ws", () => {
    socketOpened = true;
  });

  await page.goto("/terminal");
  await page.getByRole("button", { name: "Start terminal" }).click();
  await expect(page.locator(".terminal-session-state")).toHaveText("Disabled");
  await expect(page.getByText(/Full terminal is disabled on this host/)).toBeVisible();
  await expect(page.locator(".xterm")).toHaveCount(0);
  expect(socketOpened).toBe(false);
});
