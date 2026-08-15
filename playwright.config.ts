import { defineConfig } from "@playwright/test";

const viewports = [
  { name: "reflow-320", width: 320, height: 700 },
  { name: "android-360", width: 360, height: 800 },
  { name: "a55-class", width: 412, height: 915 },
  { name: "a55-landscape", width: 915, height: 412 },
] as const;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  webServer: {
    command: "npm run preview:web",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
  projects: viewports.map(({ name, width, height }) => ({
    name,
    use: {
      baseURL: "http://127.0.0.1:4173",
      viewport: { width, height },
      hasTouch: width <= 430,
      isMobile: width <= 430,
    },
  })),
});
