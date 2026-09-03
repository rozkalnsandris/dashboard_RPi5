import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const BUILD_ID_PATTERN = /^[0-9a-f]{40}$/;
const SERVICE_WORKER_BUILD_ID_PLACEHOLDER = "__DASHBOARD_BUILD_ID__";

function resolveBuildId(): string {
  const explicitBuildId = process.env.DASHBOARD_BUILD_ID?.trim();
  if (explicitBuildId) {
    if (!BUILD_ID_PATTERN.test(explicitBuildId)) {
      throw new Error("DASHBOARD_BUILD_ID must be an exact 40-character lowercase Git SHA");
    }
    return explicitBuildId;
  }

  let gitBuildId: string;
  try {
    gitBuildId = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Unable to resolve dashboard build ID; set DASHBOARD_BUILD_ID to the exact source SHA");
  }

  if (!BUILD_ID_PATTERN.test(gitBuildId)) {
    throw new Error("Resolved dashboard build ID is not an exact 40-character lowercase Git SHA");
  }
  return gitBuildId;
}

function serviceWorkerBuildIdPlugin(buildId: string): Plugin {
  let serviceWorkerPath = "";

  return {
    name: "dashboard-service-worker-build-id",
    apply: "build",
    configResolved(config) {
      serviceWorkerPath = resolve(config.root, config.build.outDir, "sw.js");
    },
    async closeBundle() {
      const source = await readFile(serviceWorkerPath, "utf8");
      const placeholderCount = source.split(SERVICE_WORKER_BUILD_ID_PLACEHOLDER).length - 1;
      if (placeholderCount !== 1) {
        throw new Error(`Expected exactly one service-worker build ID placeholder, found ${placeholderCount}`);
      }
      await writeFile(
        serviceWorkerPath,
        source.replace(SERVICE_WORKER_BUILD_ID_PLACEHOLDER, buildId),
        "utf8",
      );
    },
  };
}

export default defineConfig(({ command }) => {
  const buildId = command === "build" ? resolveBuildId() : null;

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(buildId ? [serviceWorkerBuildIdPlugin(buildId)] : []),
    ],
    server: {
      host: "127.0.0.1",
    },
  };
});
