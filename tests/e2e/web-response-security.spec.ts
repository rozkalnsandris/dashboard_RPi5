import { expect, test } from "@playwright/test";

import { CONTENT_SECURITY_POLICY } from "../../apps/server/src/http-response-policy.js";

type WindowWithCspViolations = Window & {
  __dashboardCspViolations: string[];
};

test("built browser shell runs without violations under the reviewed CSP", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1440",
    "One browser project is sufficient for CSP compatibility",
  );

  await page.addInitScript(() => {
    const target = window as WindowWithCspViolations;
    target.__dashboardCspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      target.__dashboardCspViolations.push(
        `${event.effectiveDirective}:${event.blockedURI}`,
      );
    });
  });

  await page.route("**/*", async (route) => {
    const response = await route.fetch();
    const headers = response.headers();

    if (route.request().resourceType() === "document") {
      headers["content-security-policy"] = CONTENT_SECURITY_POLICY;
    }

    await route.fulfill({ response, headers });
  });

  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
  expect(response?.headers()["content-security-policy"]).toBe(CONTENT_SECURITY_POLICY);

  await expect(page.locator("#root")).not.toBeEmpty();

  const violations = await page.evaluate(
    () => (window as WindowWithCspViolations).__dashboardCspViolations,
  );
  expect(violations).toEqual([]);
});
