import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyPaths } from "./ci-scope.mjs";

test("documentation-only changes take the cheap lane", () => {
  assert.deepEqual(
    classifyPaths(["README.md", "docs/ROADMAP.md", "AGENTS.md", ".github/pull_request_template.md"]),
    {
      mode: "docs-only",
      docsOnly: true,
      core: false,
      runtime: false,
      browser: false,
      terminal: false,
    },
  );
});

test("web changes keep core, runtime and responsive browser coverage", () => {
  const scope = classifyPaths(["apps/web/src/pages/Dashboard.tsx", "docs/ROADMAP.md"]);
  assert.equal(scope.mode, "scoped");
  assert.equal(scope.core, true);
  assert.equal(scope.runtime, true);
  assert.equal(scope.browser, true);
  assert.equal(scope.terminal, false);
});

test("server and agent changes keep core/runtime without native PTY work", () => {
  assert.deepEqual(classifyPaths(["apps/server/src/index.ts", "apps/agent/src/index.ts"]), {
    mode: "scoped",
    docsOnly: false,
    core: true,
    runtime: true,
    browser: false,
    terminal: false,
  });
});

test("terminal-agent changes retain the native matrix", () => {
  const scope = classifyPaths(["apps/terminal-agent/src/index.ts"]);
  assert.equal(scope.core, true);
  assert.equal(scope.runtime, true);
  assert.equal(scope.browser, false);
  assert.equal(scope.terminal, true);
});

test("e2e-only changes run core and browser validation but not runtime/native lanes", () => {
  const scope = classifyPaths(["tests/e2e/responsive.spec.ts"]);
  assert.equal(scope.core, true);
  assert.equal(scope.runtime, false);
  assert.equal(scope.browser, true);
  assert.equal(scope.terminal, false);
});

test("workflow, dependency, host-boundary and unknown changes fail open to full CI", () => {
  for (const path of [
    ".github/workflows/ci.yml",
    "package-lock.json",
    "ops/systemd/dashboard-rpi5-agent.service",
    "tools/new-validator.mjs",
    "unexpected/new-source.ts",
  ]) {
    assert.deepEqual(
      classifyPaths([path]),
      {
        mode: "full",
        docsOnly: false,
        core: true,
        runtime: true,
        browser: true,
        terminal: true,
      },
      path,
    );
  }
});

test("missing diff evidence fails open to full CI", () => {
  assert.equal(classifyPaths([]).mode, "full");
  assert.equal(classifyPaths(["", "   "]).terminal, true);
});

test("CI does not rerun unchanged PR heads on review-state toggles", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /pull_request:\n\s+types: \[opened, synchronize, reopened\]/);
  assert.match(workflow, /push:\n\s+branches: \[main\]/);
  assert.doesNotMatch(workflow, /ready_for_review|converted_to_draft/);
});

test("CI validates preinstalled native compiler tools without apt installs in the core job", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const start = workflow.indexOf("\n  check:");
  const end = workflow.indexOf("\n  terminal-native:");
  assert.ok(start >= 0 && end > start);
  const core = workflow.slice(start, end);
  assert.match(core, /Verify preinstalled native toolchain/);
  for (const command of ["make", "g++", "python3"]) {
    assert.ok(core.includes(`command -v ${command}`), command);
  }
  assert.doesNotMatch(core, /sudo apt-get/);
  for (const preserved of [
    "npm ci --ignore-scripts",
    "npm audit --audit-level=high",
    "npm rebuild node-pty",
    "npm run typecheck",
    "npm run lint",
    "npm run test",
    "npm run build",
    "production-candidate-manifest.mjs",
    "production-runtime-smoke.mjs",
    "npm run test:e2e",
  ]) {
    assert.ok(core.includes(preserved), preserved);
  }
  const native = workflow.slice(end);
  assert.match(native, /ubuntu-24\.04-arm/);
  assert.match(native, /npm run test:native:packaged/);
  assert.match(native, /FAST-LANE Merge Gate/);
});
