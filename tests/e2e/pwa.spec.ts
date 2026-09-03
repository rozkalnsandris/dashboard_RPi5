import { expect, test } from "@playwright/test";

test("PWA manifest exposes standalone identity and required icon sizes", async ({ page }) => {
  await page.goto("/");

  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(manifestLink).toHaveAttribute("crossorigin", "use-credentials");
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
      expect.objectContaining({ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }),
      expect.objectContaining({ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }),
      expect.objectContaining({ src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }),
    ]),
  );

  for (const icon of manifest.icons) {
    const iconResponse = await page.request.get(icon.src);
    expect(iconResponse.ok(), `${icon.src} should be served`).toBe(true);
    expect(["image/png", "image/svg+xml"]).toContain(icon.type);
  }
});

test("offline state is explicit and never looks current", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  const banner = page.locator(".offline-banner");
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

test("service worker versions static caches by exact build and preserves the cache boundary", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "One browser project is sufficient for service-worker cache semantics");

  await page.goto("/");
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) throw new Error("service workers unavailable");
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  const serviceWorkerResponse = await page.request.get("/sw.js");
  expect(serviceWorkerResponse.ok()).toBe(true);
  const serviceWorkerSource = await serviceWorkerResponse.text();
  expect(serviceWorkerSource).not.toContain("__DASHBOARD_BUILD_ID__");
  const buildIdMatch = serviceWorkerSource.match(/const BUILD_ID = "([0-9a-f]{40})";/);
  if (!buildIdMatch?.[1]) throw new Error("built service worker is missing its exact source build ID");
  const currentCacheName = `dashboard-rpi5-static-${buildIdMatch[1]}`;

  const updateViaCache = await page.evaluate(async () => (await navigator.serviceWorker.ready).updateViaCache);
  expect(updateViaCache).toBe("none");

  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("runtime image load failed"));
      image.src = "/icons/icon-192.png?runtime-cache=1";
      document.body.append(image);
    });
    await fetch("/api/pwa-cache-probe").catch(() => undefined);
  });

  const cachedState = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls: string[] = [];
    for (const key of keys) {
      if (!key.startsWith("dashboard-rpi5-static-")) continue;
      const cache = await caches.open(key);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return { keys, urls };
  });

  expect(cachedState.keys).toContain(currentCacheName);
  expect(cachedState.keys).not.toContain("dashboard-rpi5-static-v1");
  expect(cachedState.urls.some((url) => url.includes("/api/"))).toBe(false);
  expect(cachedState.urls.some((url) => url.endsWith("/offline.html"))).toBe(true);
  expect(cachedState.urls.some((url) => url.includes("icon-192.png?runtime-cache=1"))).toBe(true);

  const staleCacheName = "dashboard-rpi5-static-stale-browser-test";
  const unrelatedCacheName = "unrelated-origin-cache-browser-test";
  await page.evaluate(
    async ({ staleCacheName, unrelatedCacheName }) => {
      await caches.open(staleCacheName);
      await caches.open(unrelatedCacheName);
      const registration = await navigator.serviceWorker.ready;
      await registration.unregister();
    },
    { staleCacheName, unrelatedCacheName },
  );

  await page.reload();
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) throw new Error("service workers unavailable");
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  const cacheKeysAfterActivation = await page.evaluate(async () => caches.keys());
  expect(cacheKeysAfterActivation).toContain(currentCacheName);
  expect(cacheKeysAfterActivation).not.toContain(staleCacheName);
  expect(cacheKeysAfterActivation).toContain(unrelatedCacheName);
  await page.evaluate(async (cacheName) => caches.delete(cacheName), unrelatedCacheName);

  await page.context().setOffline(true);
  try {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Live dashboard data is unavailable." })).toBeVisible();
    await expect(page.getByText(/contains no cached operational state/i)).toBeVisible();
  } finally {
    await page.context().setOffline(false);
  }
});
