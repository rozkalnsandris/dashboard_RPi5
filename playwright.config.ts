import { defineConfig } from "@playwright/test";

const viewports = [
  { name: "reflow-320", width: 320, height: 700, mobile: true },
  { name: "android-360", width: 360, height: 800, mobile: true },
  { name: "android-384", width: 384, height: 854, mobile: true },
  { name: "phone-393", width: 393, height: 873, mobile: true },
  { name: "a55-class", width: 412, height: 915, mobile: true },
  { name: "wide-phone-430", width: 430, height: 932, mobile: true },
  { name: "compact-landscape", width: 800, height: 360, mobile: true },
  { name: "a55-landscape", width: 915, height: 412, mobile: true },
  { name: "desktop-1440", width: 1440, height: 900, mobile: false },
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
  projects: viewports.map(({ name, width, height, mobile }) => ({
    name,
    use: {
      baseURL: "http://127.0.0.1:4173",
      viewport: { width, height },
      hasTouch: mobile,
      isMobile: mobile,
    },
  })),
});
