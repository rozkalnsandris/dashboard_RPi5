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
  verifyProductionCandidateManifest,
} from "./production-candidate-manifest.mjs";
import {
  assertPackagedTerminalNativeRuntime,
  stageTerminalNativeRuntime,
  TERMINAL_NATIVE_RUNTIME_FILES,
  TERMINAL_NATIVE_RUNTIME_RELATIVE_ROOT,
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
    await writeFileAt(sourceRoot, relativePath, `fixture:${relativePath}\n`);
  }
  return sourceRoot;
}

async function modeOf(path) {
  return (await stat(path)).mode & 0o777;
}

async function writeCandidateSkeleton(root, { terminalEntrypoint = true } = {}) {
  for (const directory of PRODUCTION_CANDIDATE_DIRECTORY_ROOTS) {
    await writeFileAt(root, `${directory}/artifact.txt`, `artifact:${directory}\n`);
  }
  if (terminalEntrypoint) {
    await writeFileAt(root, "apps/terminal-agent/dist/session-stdio-entry.js", "export {};\n");
  }
  for (const file of PRODUCTION_CANDIDATE_FILE_ROOTS) {
    await writeFileAt(root, file, `file:${file}\n`);
  }
}

test("native runtime staging copies exactly the reviewed Linux runtime and normalizes 0644", async (t) => {
  const root = await workspace(t, "dashboard-issue206-stage-");
  await writeSourceRuntime(root);

  const result = await stageTerminalNativeRuntime({
    rootDir: root,
    platform: "linux",
    arch: "arm64",
  });
  assert.equal(result.status, "PACKAGED");
  assert.equal(result.package, "node-pty@1.1.0");
  assert.equal(result.binding, `${TERMINAL_NATIVE_RUNTIME_RELATIVE_ROOT}/build/Release/pty.node`);

  const verified = await assertPackagedTerminalNativeRuntime({
    rootDir: root,
    platform: "linux",
    arch: "arm64",
  });
  assert.equal(verified.status, "PASS");
  assert.deepEqual(TERMINAL_NATIVE_RUNTIME_FILES, [
    "LICENSE",
    "package.json",
    "lib/index.js",
    "lib/utils.js",
    "lib/unixTerminal.js",
    "lib/terminal.js",
    "lib/eventEmitter2.js",
    "build/Release/pty.node",
  ]);
  for (const relativePath of TERMINAL_NATIVE_RUNTIME_FILES) {
    assert.equal(
      await modeOf(resolve(root, TERMINAL_NATIVE_RUNTIME_RELATIVE_ROOT, ...relativePath.split("/"))),
      0o644,
      relativePath,
    );
  }
});

test("native runtime staging fails closed on wrong version, symlink and unsupported platform", async (t) => {
  const wrongVersion = await workspace(t, "dashboard-issue206-version-");
  await writeSourceRuntime(wrongVersion, { version: "1.1.1" });
  await assert.rejects(
    stageTerminalNativeRuntime({ rootDir: wrongVersion, platform: "linux", arch: "x64" }),
    /package identity mismatch/u,
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

  const unsupported = await workspace(t, "dashboard-issue206-platform-");
  await writeSourceRuntime(unsupported);
  await assert.rejects(
    stageTerminalNativeRuntime({ rootDir: unsupported, platform: "darwin", arch: "arm64" }),
    /supports only linux x64\/arm64/u,
  );
});

test("if-built mode is inert when explicit node-pty build output is absent", async (t) => {
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

test("packaged runtime validator rejects extra files and executable-bit drift", async (t) => {
  const extraRoot = await workspace(t, "dashboard-issue206-extra-");
  await writeSourceRuntime(extraRoot);
  await stageTerminalNativeRuntime({ rootDir: extraRoot, platform: "linux", arch: "x64" });
  await writeFileAt(resolve(extraRoot, TERMINAL_NATIVE_RUNTIME_RELATIVE_ROOT), "unexpected.js", "nope\n");
  await assert.rejects(
    assertPackagedTerminalNativeRuntime({ rootDir: extraRoot, platform: "linux", arch: "x64" }),
    /file allowlist mismatch/u,
  );

  const executableRoot = await workspace(t, "dashboard-issue206-mode-");
  await writeSourceRuntime(executableRoot);
  await stageTerminalNativeRuntime({ rootDir: executableRoot, platform: "linux", arch: "x64" });
  await chmod(resolve(executableRoot, TERMINAL_NATIVE_RUNTIME_RELATIVE_ROOT, "build/Release/pty.node"), 0o755);
  await assert.rejects(
    assertPackagedTerminalNativeRuntime({ rootDir: executableRoot, platform: "linux", arch: "x64" }),
    /must not be executable/u,
  );
});

test("programmatic candidate verification requires exact packaged runtime when terminal entrypoint exists", async (t) => {
  const missingRoot = await workspace(t, "dashboard-issue206-candidate-missing-");
  await writeCandidateSkeleton(missingRoot);
  const missingManifest = await createProductionCandidateManifest({ rootDir: missingRoot, sourceSha: SHA });
  await assert.rejects(
    verifyProductionCandidateManifest({ rootDir: missingRoot, sourceSha: SHA, manifest: missingManifest }),
    /ENOENT|packaged terminal native runtime/u,
  );

  const completeRoot = await workspace(t, "dashboard-issue206-candidate-complete-");
  await writeCandidateSkeleton(completeRoot);
  await writeSourceRuntime(completeRoot);
  await stageTerminalNativeRuntime({ rootDir: completeRoot, platform: "linux", arch: process.arch });
  const completeManifest = await createProductionCandidateManifest({ rootDir: completeRoot, sourceSha: SHA });
  const verified = await verifyProductionCandidateManifest({
    rootDir: completeRoot,
    sourceSha: SHA,
    manifest: completeManifest,
  });
  assert.equal(verified.candidateSha256, completeManifest.candidateSha256);
});

test("source contracts keep fixed packaged loading and production terminal disabled", async () => {
  const nativeSource = await readFile(resolve(ROOT, "apps/terminal-agent/src/native-pty.ts"), "utf8");
  assert.match(nativeSource, /TERMINAL_NATIVE_PACKAGED_MODULE = "\.\/native\/node-pty"/u);
  assert.match(nativeSource, /require\(TERMINAL_NATIVE_PACKAGED_MODULE\)/u);
  assert.doesNotMatch(nativeSource, /require\(["']node-pty["']\)/u);
  assert.doesNotMatch(nativeSource, /NODE_PATH|process\.env\.[A-Z_]*PTY/iu);

  const packagerSource = await readFile(resolve(ROOT, "tools/package-terminal-native-runtime.mjs"), "utf8");
  assert.doesNotMatch(packagerSource, /spawn-helper/u);
  assert.match(packagerSource, /"LICENSE"/u);

  const manifestSource = await readFile(resolve(ROOT, "tools/production-candidate-manifest.mjs"), "utf8");
  assert.match(manifestSource, /await assertProgrammaticTerminalRuntimeClosure\(rootDir\);/u);

  const releaseContract = JSON.parse(
    await readFile(resolve(ROOT, "ops/production/release-activation-contract.json"), "utf8"),
  );
  assert.equal("executableFileModes" in releaseContract, false);
  assert.equal(releaseContract.releaseMetadata.regularFileMode, "0644");

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
