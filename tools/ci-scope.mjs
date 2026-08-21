import { resolve } from "node:path";
import { argv, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const DOC_FILES = new Set([
  "README.md",
  "AGENTS.md",
  "SECURITY.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
]);
const DOC_PREFIXES = ["docs/", ".github/ISSUE_TEMPLATE/"];
const FULL_FILES = new Set([
  ".node-version",
  "package.json",
  "package-lock.json",
  "eslint.config.js",
  "playwright.config.ts",
  "tsconfig.json",
]);
const FULL_PREFIXES = [".github/workflows/", "ops/"];
const WEB_PREFIXES = ["apps/web/"];
const E2E_PREFIXES = ["tests/e2e/"];
const RUNTIME_PREFIXES = ["apps/server/", "apps/agent/", "packages/contracts/"];
const TERMINAL_PREFIXES = ["apps/terminal-agent/"];

const hasPrefix = (path, prefixes) => prefixes.some((prefix) => path.startsWith(prefix));
const isDocumentationPath = (path) => DOC_FILES.has(path) || hasPrefix(path, DOC_PREFIXES);

const fullScope = () => ({
  mode: "full",
  docsOnly: false,
  core: true,
  runtime: true,
  browser: true,
  terminal: true,
});

export function classifyPaths(inputPaths) {
  const paths = [...new Set(inputPaths.map((path) => path.trim()).filter(Boolean))];

  // Missing/ambiguous diff evidence must fail open to the complete validation surface.
  if (paths.length === 0) return fullScope();

  if (paths.every(isDocumentationPath)) {
    return {
      mode: "docs-only",
      docsOnly: true,
      core: false,
      runtime: false,
      browser: false,
      terminal: false,
    };
  }

  let core = false;
  let runtime = false;
  let browser = false;
  let terminal = false;

  for (const path of paths) {
    if (isDocumentationPath(path)) continue;

    // Workflow/toolchain/host-boundary changes deliberately receive every lane.
    if (FULL_FILES.has(path) || hasPrefix(path, FULL_PREFIXES)) return fullScope();

    if (hasPrefix(path, WEB_PREFIXES)) {
      core = true;
      runtime = true;
      browser = true;
      continue;
    }

    if (hasPrefix(path, E2E_PREFIXES)) {
      core = true;
      browser = true;
      continue;
    }

    if (hasPrefix(path, TERMINAL_PREFIXES)) {
      core = true;
      runtime = true;
      terminal = true;
      continue;
    }

    if (hasPrefix(path, RUNTIME_PREFIXES)) {
      core = true;
      runtime = true;
      continue;
    }

    // Unknown source/tool paths are never optimized speculatively.
    return fullScope();
  }

  return {
    mode: "scoped",
    docsOnly: false,
    core,
    runtime,
    browser,
    terminal,
  };
}

function printGithubOutputs(scope) {
  const entries = [
    ["mode", scope.mode],
    ["docs_only", scope.docsOnly],
    ["core", scope.core],
    ["runtime", scope.runtime],
    ["browser", scope.browser],
    ["terminal", scope.terminal],
  ];
  for (const [key, value] of entries) stdout.write(`${key}=${value}\n`);
}

const invokedPath = argv[1] ? resolve(argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  printGithubOutputs(classifyPaths(argv.slice(2)));
}
