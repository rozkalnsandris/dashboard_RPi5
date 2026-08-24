import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PRODUCTION_CANDIDATE_DIRECTORY_ROOTS,
  PRODUCTION_CANDIDATE_FILE_ROOTS,
  createProductionCandidateManifest,
} from "./production-candidate-manifest.mjs";
import {
  applyReleaseActivation,
  validateReleaseActivationContract,
} from "./production-release-controller.mjs";
import {
  assertPackagedTerminalNativeRuntime,
  stageTerminalNativeRuntime,
  TERMINAL_NATIVE_RUNTIME_FILES,
  TERMINAL_NATIVE_RUNTIME_RELATIVE_ROOT,
  TERMINAL_NATIVE_SPAWN_HELPER_RELATIVE_PATH,
} from "./package-terminal-native-runtime.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHA = "c".repeat(40);

async function workspace(t, prefix) {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeFileAt(root, relativePath, content, mode = 0o644) {
  const path = resolve(root, ...relativePath.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  await chmod(path, mode);
  return path;
}

async function writeSourceRuntime(root, options = {}) {
  const sourceRoot = resolve(root, "node_modules/node-pty");
  await mkdir(resolve(root, "apps/terminal-agent/dist"), { recursive: true });
  for (const relativePath of TERMINAL_NATIVE_RUNTIME_FILES) {
    if (relativePath === "package.json") {
      await writeFileAt(
        sourceRoot,
        relativePath,
        `${JSON.stringify({
          name: "node-pty",
          version: options.version ?? "1.1.0",
          main: "./lib/index.js",
        })}\n`,
      );
      continue;
    }
    const mode = relativePath === "build/Release/spawn-helper" ? (options.helperMode ?? 0o755) : 0o644;
    await writeFileAt(sourceRoot, relativePath, `fixture:${relativePath}\n`, mode);
  }
  return sourceRoot;
}

async function modeOf(path) {
  return (await stat(path)).mode & 0o777;
}

test("native runtime staging copies only the reviewed Linux package subset", async (t) => {
  const root = await workspace(t, "dashboard-issue206-stage-");
  await writeSourceRuntime(root);

  const result = await stageTerminalNativeRuntime({
    rootDir: root,
    platform: "linux",
    arch: "arm64",
  });
  assert.equal(result.status, "PACKAGED");
  assert.equal(result.package, "node-pty@1.1.0");

  const verified = await assertPackagedTerminalNativeRuntime({
    rootDir: root,
    platform: "linux",
    arch: "arm64",
  });
  assert.equal(verified.status, "PASS");
  assert.equal(
    await modeOf(resolve(root, TERMINAL_NATIVE_SPAWN_HELPER_RELATIVE_PATH)),
    0o755,
  );
  assert.equal(
    await modeOf(resolve(root, TERMINAL_NATIVE_RUNTIME_RELATIVE_ROOT, "build/Release/pty.node")),
    0o644,
  );
});

test("native runtime staging fails closed on package/version, symlink and helper-mode drift", async (t) => {
  const wrongVersion = await workspace(t, "dashboard-issue206-version-");
  await writeSourceRuntime(wrongVersion, { version: "1.1.1" });
  await assert.rejects(
    stageTerminalNativeRuntime({ rootDir: wrongVersion, platform: "linux", arch: "x64" }),
    /package identity mismatch/u,
  );

  const nonExecutable = await workspace(t, "dashboard-issue206-helper-");
  await writeSourceRuntime(nonExecutable, { helperMode: 0o644 });
  await assert.rejects(
    stageTerminalNativeRuntime({ rootDir: nonExecutable, platform: "linux", arch: "x64" }),
    /spawn-helper must be executable/u,
  );

  const symlinkRoot = await workspace(t, "dashboard-issue206-symlink-");
  const sourceRoot = await writeSourceRuntime(symlinkRoot);
  const target = await writeFileAt(symlinkRoot, "outside.js", "outside\n");
  const linked = resolve(sourceRoot, "lib/utils.js");
  await rm(linked);
  await symlink(target, linked);
  await assert.rejects(
    stageTerminalNativeRuntime({ rootDir: symlinkRoot, platform: "linux", arch: "x64" }),
    /regular file/u,
  );
});

test("if-built mode is inert when no explicit node-pty build output exists", async (t) => {
  const root = await workspace(t, "dashboard-issue206-skip-");
  await mkdir(resolve(root, "apps/terminal-agent/dist"), { recursive: true });
  const result = await stageTerminalNativeRuntime({
    rootDir: root,
    ifBuilt: true,
    platform: "linux",
    arch: "x64",
  });
  assert.deepEqual(result, {
    status: "SKIPPED",
    reason: "native-build-absent",
    platform: "linux",
    arch: "x64",
  });
});

test("packaged runtime validator rejects extra files and executable drift", async (t) => {
  const root = await workspace(t, "dashboard-issue206-packaged-");
  await writeSourceRuntime(root);
  await stageTerminalNativeRuntime({ rootDir: root, platform: "linux", arch: "x64" });
  await writeFileAt(resolve(root, TERMINAL_NATIVE_RUNTIME_RELATIVE_ROOT), "unexpected.js", "nope\n");
  await assert.rejects(
    assertPackagedTerminalNativeRuntime({ rootDir: root, platform: "linux", arch: "x64" }),
    /file allowlist mismatch/u,
  );
});

async function makeReleaseCandidate(t) {
  const root = await workspace(t, "dashboard-issue206-release-");
  const candidateRoot = resolve(root, "candidate");
  await mkdir(candidateRoot, { recursive: true });
  for (const directory of PRODUCTION_CANDIDATE_DIRECTORY_ROOTS) {
    await writeFileAt(candidateRoot, `${directory}/artifact.txt`, `artifact:${directory}\n`);
  }
  await writeFileAt(
    candidateRoot,
    TERMINAL_NATIVE_SPAWN_HELPER_RELATIVE_PATH,
    "spawn-helper-fixture\n",
    0o600,
  );
  for (const file of PRODUCTION_CANDIDATE_FILE_ROOTS) {
    await writeFileAt(candidateRoot, file, `file:${file}\n`);
  }
  const manifest = await createProductionCandidateManifest({ rootDir: candidateRoot, sourceSha: SHA });
  const manifestPath = resolve(root, "candidate-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
  return { root, candidateRoot, manifestPath };
}

test("release controller grants executable mode only to packaged spawn-helper", async (t) => {
  const contract = validateReleaseActivationContract(
    JSON.parse(await readFile(resolve(ROOT, "ops/production/release-activation-contract.json"), "utf8")),
  );
  assert.deepEqual(contract.executableFileModes, {
    [TERMINAL_NATIVE_SPAWN_HELPER_RELATIVE_PATH]: "0755",
  });

  const candidate = await makeReleaseCandidate(t);
  const activationRoot = resolve(candidate.root, "activation");
  const result = await applyReleaseActivation({
    activationRoot,
    candidateRoot: candidate.candidateRoot,
    manifestPath: candidate.manifestPath,
    sourceSha: SHA,
    expectedCurrent: "none",
    contract,
  });
  assert.equal(result.status, "APPLIED");
  const releaseRoot = resolve(activationRoot, "releases", SHA);
  assert.equal(
    await modeOf(resolve(releaseRoot, TERMINAL_NATIVE_SPAWN_HELPER_RELATIVE_PATH)),
    0o755,
  );
  assert.equal(await modeOf(resolve(releaseRoot, "package.json")), 0o644);
});

test("source contracts keep terminal native loading fixed and activation disabled", async () => {
  const nativeSource = await readFile(resolve(ROOT, "apps/terminal-agent/src/native-pty.ts"), "utf8");
  assert.match(nativeSource, /TERMINAL_NATIVE_PACKAGED_MODULE = "\.\/native\/node-pty"/u);
  assert.match(nativeSource, /require\(TERMINAL_NATIVE_PACKAGED_MODULE\)/u);
  assert.doesNotMatch(nativeSource, /require\(["']node-pty["']\)/u);
  assert.doesNotMatch(nativeSource, /NODE_PATH|process\.env\.[A-Z_]*PTY/iu);

  const manifestSource = await readFile(resolve(ROOT, "tools/production-candidate-manifest.mjs"), "utf8");
  assert.match(manifestSource, /await assertPackagedTerminalNativeRuntime\(\{ rootDir: input\.rootDir \}\);/u);

  const rootPackage = JSON.parse(await readFile(resolve(ROOT, "package.json"), "utf8"));
  assert.match(rootPackage.scripts.check, /package-terminal-native-runtime\.mjs --root \. --if-built/u);

  const terminalPackage = JSON.parse(await readFile(resolve(ROOT, "apps/terminal-agent/package.json"), "utf8"));
  assert.equal(terminalPackage.dependencies["node-pty"], "1.1.0");
  assert.equal(terminalPackage.scripts["test:native:packaged"], "tsx tools/packaged-native-smoke.ts");

  const ciSource = await readFile(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");
  assert.match(ciSource, /npm rebuild node-pty --dangerously-allow-all-scripts --foreground-scripts/u);
  assert.match(ciSource, /node tools\/package-terminal-native-runtime\.mjs --root \./u);
  assert.match(ciSource, /npm run test:native:packaged --workspace @dashboard-rpi5\/terminal-agent/u);

  const webEnv = await readFile(resolve(ROOT, "ops/production/web.env.example"), "utf8");
  assert.match(webEnv, /DASHBOARD_TERMINAL_ENABLED=disabled/u);
});
