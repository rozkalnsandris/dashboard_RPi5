import { expect, test } from "@playwright/test";

test("PWA manifest exposes standalone identity and required icon sizes", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).toContain("viewport-fit=cover");
  expect(viewport).not.toContain("user-scalable=no");

  const response = await page.request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    id: string;
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
  };

  expect(manifest).toMatchObject({
    id: "/",
    name: "RPi5 Dashboard",
    short_name: "RPi5",
    start_url: "/",
    scope: "/",
    display: "standalone",
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192", purpose: "any" }),
      expect.objectContaining({ sizes: "512x512", purpose: "any" }),
      expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
    ]),
  );

  for (const icon of manifest.icons) {
    const iconResponse = await page.request.get(icon.src);
    expect(iconResponse.ok(), `${icon.src} should be served`).toBe(true);
    expect(icon.type).toBe("image/svg+xml");
  }
});

test("offline state is explicit and never looks current", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  const banner = page.getByRole("status");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Offline.");
  await expect(banner).toContainText("Live operational data is unavailable");

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(banner).toHaveCount(0);

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("service worker caches only reviewed static assets and uses an offline fallback", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One browser project is sufficient for service-worker cache semantics");

  await page.goto("/");
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) throw new Error("service workers unavailable");
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("runtime image load failed"));
      image.src = "/icons/icon-192.svg?runtime-cache=1";
      document.body.append(image);
    });
    await fetch("/api/pwa-cache-probe").catch(() => undefined);
  });

  const cachedUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys()) {
      if (!key.startsWith("dashboard-rpi5-static-")) continue;
      const cache = await caches.open(key);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });

  expect(cachedUrls.some((url) => url.includes("/api/"))).toBe(false);
  expect(cachedUrls.some((url) => url.endsWith("/offline.html"))).toBe(true);
  expect(cachedUrls.some((url) => url.includes("icon-192.svg?runtime-cache=1"))).toBe(true);

  await page.context().setOffline(true);
  try {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Live dashboard data is unavailable." })).toBeVisible();
    await expect(page.getByText(/contains no cached operational state/i)).toBeVisible();
  } finally {
    await page.context().setOffline(false);
  }
});
