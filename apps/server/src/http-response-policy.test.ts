import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { OutgoingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildApp } from "./app.js";
import {
  buildContentSecurityPolicy,
  CONTENT_SECURITY_POLICY,
  PERMISSIONS_POLICY,
  REFERRER_POLICY,
} from "./http-response-policy.js";

function expectSecurityHeaders(headers: OutgoingHttpHeaders) {
  const csp = headers["content-security-policy"];
  expect(typeof csp).toBe("string");
  if (typeof csp !== "string") throw new Error("CSP header is missing");
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]{24}'/);
  expect(csp).toContain("default-src 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe(REFERRER_POLICY);
  expect(headers["permissions-policy"]).toBe(PERMISSIONS_POLICY);
  expect(headers["strict-transport-security"]).toBeUndefined();
  expect(headers["x-frame-options"]).toBeUndefined();
}

describe("HTTP response security policy", () => {
  it("applies security headers and no-store to operational API responses including errors", async () => {
    const app = buildApp();

    try {
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);
      expect(health.headers["cache-control"]).toBe("no-store");
      expectSecurityHeaders(health.headers);

      const invalidHistory = await app.inject({
        method: "GET",
        url: "/api/history/host?range=not-a-range",
      });
      expect(invalidHistory.statusCode).toBe(400);
      expect(invalidHistory.headers["cache-control"]).toBe("no-store");
      expectSecurityHeaders(invalidHistory.headers);

      const missingApi = await app.inject({ method: "GET", url: "/api/not-real" });
      expect(missingApi.statusCode).toBe(404);
      expect(missingApi.headers["cache-control"]).toBe("no-store");
      expectSecurityHeaders(missingApi.headers);

      expect(health.headers["content-security-policy"]).not.toBe(
        invalidHistory.headers["content-security-policy"],
      );
      expect(invalidHistory.headers["content-security-policy"]).not.toBe(
        missingApi.headers["content-security-policy"],
      );
    } finally {
      await app.close();
    }
  });

  it("protects browser documents while preserving immutable static asset caching", async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), "dashboard-rpi5-policy-"));
    const assetsRoot = join(staticRoot, "assets");
    await mkdir(assetsRoot);
    await writeFile(join(staticRoot, "index.html"), "<!doctype html><title>fixture</title>", "utf8");
    await writeFile(join(assetsRoot, "app-a1b2c3.js"), "export {};", "utf8");
    const app = buildApp({ staticRoot });

    try {
      const documentResponse = await app.inject({ method: "GET", url: "/logs" });
      expect(documentResponse.statusCode).toBe(200);
      expect(documentResponse.headers["cache-control"]).toContain("no-store");
      expectSecurityHeaders(documentResponse.headers);

      const assetResponse = await app.inject({
        method: "GET",
        url: "/assets/app-a1b2c3.js",
      });
      expect(assetResponse.statusCode).toBe(200);
      expect(assetResponse.headers["cache-control"]).toContain("immutable");
      expect(assetResponse.headers["cache-control"]).not.toContain("no-store");
      expectSecurityHeaders(assetResponse.headers);
    } finally {
      await app.close();
      await rm(staticRoot, { recursive: true, force: true });
    }
  });

  it("keeps script execution strict while supporting Cloudflare-injected nonce scripts", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
    expect(CONTENT_SECURITY_POLICY).toContain("style-src 'self' 'unsafe-inline'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain(
      "connect-src 'self' wss://dash.rozkalns.net",
    );

    const csp = buildContentSecurityPolicy("A".repeat(24));
    const scriptDirective = csp
      .split("; ")
      .find((directive) => directive.startsWith("script-src "));
    expect(scriptDirective).toBe(`script-src 'self' 'nonce-${"A".repeat(24)}'`);
    expect(scriptDirective).not.toContain("unsafe-inline");
  });
});
