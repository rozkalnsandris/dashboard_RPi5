import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildApp } from "./app.js";

describe("dashboard server", () => {
  it("returns the bounded fixture-mode health contract", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "dashboard-rpi5-server",
      mode: "fixture",
    });

    await app.close();
  });

  it("serves the SPA shell for a deep browser route without swallowing API 404s", async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), "dashboard-rpi5-static-"));
    await writeFile(join(staticRoot, "index.html"), "<!doctype html><title>fixture shell</title>", "utf8");
    const app = buildApp({ staticRoot });

    try {
      const deepRoute = await app.inject({ method: "GET", url: "/logs" });
      expect(deepRoute.statusCode).toBe(200);
      expect(deepRoute.headers["cache-control"]).toContain("no-store");
      expect(deepRoute.body).toContain("fixture shell");

      const missingApi = await app.inject({ method: "GET", url: "/api/not-real" });
      expect(missingApi.statusCode).toBe(404);
      expect(missingApi.json()).toEqual({ error: "NOT_FOUND" });
    } finally {
      await app.close();
      await rm(staticRoot, { recursive: true, force: true });
    }
  });

  it("rejects a relative static root", () => {
    expect(() => buildApp({ staticRoot: "relative/dist" })).toThrow("staticRoot must be an absolute path");
  });
});
