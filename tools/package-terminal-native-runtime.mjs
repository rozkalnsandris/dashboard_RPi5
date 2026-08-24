import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const TERMINAL_NATIVE_PACKAGE_VERSION = "1.1.0";
export const TERMINAL_NATIVE_RUNTIME_RELATIVE_ROOT =
  "apps/terminal-agent/dist/native/node-pty";
export const TERMINAL_NATIVE_BINDING_RELATIVE_PATH =
  `${TERMINAL_NATIVE_RUNTIME_RELATIVE_ROOT}/build/Release/pty.node`;
export const TERMINAL_NATIVE_SPAWN_HELPER_RELATIVE_PATH =
  `${TERMINAL_NATIVE_RUNTIME_RELATIVE_ROOT}/build/Release/spawn-helper`;

const SOURCE_PACKAGE_RELATIVE_ROOT = "node_modules/node-pty";
const MAX_RUNTIME_FILE_BYTES = 32 * 1024 * 1024;
const PACKAGE_FILE_MODE = 0o644;
const SPAWN_HELPER_MODE = 0o755;
const SUPPORTED_ARCHES = new Set(["x64", "arm64"]);
export const TERMINAL_NATIVE_RUNTIME_FILES = Object.freeze([
  "package.json",
  "lib/index.js",
  "lib/interfaces.js",
  "lib/types.js",
  "lib/utils.js",
  "lib/terminal.js",
  "lib/eventEmitter2.js",
  "lib/unixTerminal.js",
  "build/Release/pty.node",
  "build/Release/spawn-helper",
]);

function assertSupportedRuntime(platform, arch, allowSkip) {
  const supported = platform === "linux" && SUPPORTED_ARCHES.has(arch);
  if (!supported && allowSkip) return false;
  if (!supported) {
    throw new Error(`terminal native runtime packaging supports only linux x64/arm64, got ${platform}/${arch}`);
  }
  return true;
}

function assertWithin(root, candidate, label) {
  const value = relative(root, candidate);
  if (value === "" || value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    throw new Error(`${label} escaped reviewed root`);
  }
}

async function pathState(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertRealDirectory(path, label) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory`);
  }
  return stat;
}

async function assertRegularFile(path, label, { executable = false, forbidExecutable = false } = {}) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
  if (stat.size <= 0 || stat.size > MAX_RUNTIME_FILE_BYTES) {
    throw new Error(`${label} size is invalid`);
  }
  const executableBits = stat.mode & 0o111;
  if (executable && executableBits === 0) {
    throw new Error(`${label} must be executable`);
  }
  if (forbidExecutable && executableBits !== 0) {
    throw new Error(`${label} must not be executable`);
  }
  return stat;
}

async function readPackageJson(packageRoot, label) {
  const path = resolve(packageRoot, "package.json");
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > 64 * 1024) {
    throw new Error(`${label} package.json must be a bounded regular file`);
  }
  const value = JSON.parse(await readFile(path, "utf8"));
  if (
    value?.name !== "node-pty" ||
    value?.version !== TERMINAL_NATIVE_PACKAGE_VERSION ||
    value?.main !== "./lib/index.js"
  ) {
    throw new Error(`${label} node-pty package identity mismatch`);
  }
  return value;
}

async function collectRelativeFiles(root, current = root) {
  const stat = await lstat(current);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("packaged terminal native runtime directory must be real");
  }
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  const files = [];
  for (const entry of entries) {
    const absolute = resolve(current, entry.name);
    assertWithin(root, absolute, "packaged terminal native runtime entry");
    if (entry.isSymbolicLink()) {
      throw new Error("packaged terminal native runtime symlink is forbidden");
    }
    if (entry.isDirectory()) {
      files.push(...(await collectRelativeFiles(root, absolute)));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error("packaged terminal native runtime special file is forbidden");
    }
    files.push(relative(root, absolute).split(sep).join("/"));
  }
  return files;
}

export async function assertPackagedTerminalNativeRuntime({
  rootDir,
  platform = process.platform,
  arch = process.arch,
}) {
  assertSupportedRuntime(platform, arch, false);
  const root = resolve(rootDir);
  await assertRealDirectory(root, "candidate root");
  const runtimeRoot = resolve(root, TERMINAL_NATIVE_RUNTIME_RELATIVE_ROOT);
  assertWithin(root, runtimeRoot, "terminal native runtime root");
  await assertRealDirectory(runtimeRoot, "packaged terminal native runtime root");

  const actualFiles = (await collectRelativeFiles(runtimeRoot)).sort();
  const expectedFiles = [...TERMINAL_NATIVE_RUNTIME_FILES].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("packaged terminal native runtime file allowlist mismatch");
  }

  await readPackageJson(runtimeRoot, "packaged");
  for (const relativePath of TERMINAL_NATIVE_RUNTIME_FILES) {
    const absolute = resolve(runtimeRoot, ...relativePath.split("/"));
    assertWithin(runtimeRoot, absolute, "packaged terminal native runtime file");
    await assertRegularFile(absolute, `packaged ${relativePath}`, {
      executable: relativePath === "build/Release/spawn-helper",
      forbidExecutable: relativePath !== "build/Release/spawn-helper",
    });
  }

  return {
    status: "PASS",
    package: `node-pty@${TERMINAL_NATIVE_PACKAGE_VERSION}`,
    platform,
    arch,
    runtimeRoot: TERMINAL_NATIVE_RUNTIME_RELATIVE_ROOT,
    binding: TERMINAL_NATIVE_BINDING_RELATIVE_PATH,
    spawnHelper: TERMINAL_NATIVE_SPAWN_HELPER_RELATIVE_PATH,
  };
}

async function assertSourceRuntime(sourceRoot) {
  await assertRealDirectory(sourceRoot, "source node-pty root");
  await readPackageJson(sourceRoot, "source");
  for (const relativePath of TERMINAL_NATIVE_RUNTIME_FILES) {
    const absolute = resolve(sourceRoot, ...relativePath.split("/"));
    assertWithin(sourceRoot, absolute, "source terminal native runtime file");
    await assertRegularFile(absolute, `source ${relativePath}`, {
      executable: relativePath === "build/Release/spawn-helper",
    });
  }
}

async function copyRuntimeFile(sourceRoot, destinationRoot, relativePath) {
  const source = resolve(sourceRoot, ...relativePath.split("/"));
  const destination = resolve(destinationRoot, ...relativePath.split("/"));
  assertWithin(sourceRoot, source, "source terminal native runtime file");
  assertWithin(destinationRoot, destination, "destination terminal native runtime file");
  await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  await chmod(
    destination,
    relativePath === "build/Release/spawn-helper" ? SPAWN_HELPER_MODE : PACKAGE_FILE_MODE,
  );
}

export async function stageTerminalNativeRuntime({
  rootDir,
  ifBuilt = false,
  platform = process.platform,
  arch = process.arch,
}) {
  if (!assertSupportedRuntime(platform, arch, ifBuilt)) {
    return { status: "SKIPPED", reason: "unsupported-host", platform, arch };
  }

  const root = resolve(rootDir);
  await assertRealDirectory(root, "repository root");
  const sourceRoot = resolve(root, SOURCE_PACKAGE_RELATIVE_ROOT);
  const destinationRoot = resolve(root, TERMINAL_NATIVE_RUNTIME_RELATIVE_ROOT);
  assertWithin(root, sourceRoot, "source node-pty root");
  assertWithin(root, destinationRoot, "destination terminal native runtime root");

  const bindingSource = resolve(sourceRoot, "build/Release/pty.node");
  const helperSource = resolve(sourceRoot, "build/Release/spawn-helper");
  const bindingState = await pathState(bindingSource);
  const helperState = await pathState(helperSource);
  const destinationState = await pathState(destinationRoot);

  if (ifBuilt && bindingState === null && helperState === null && destinationState === null) {
    return { status: "SKIPPED", reason: "native-build-absent", platform, arch };
  }
  if (bindingState === null || helperState === null) {
    throw new Error("explicit node-pty source build output is incomplete");
  }
  if (destinationState !== null) {
    throw new Error("packaged terminal native runtime destination already exists");
  }

  await assertSourceRuntime(sourceRoot);
  const terminalDist = resolve(root, "apps/terminal-agent/dist");
  await assertRealDirectory(terminalDist, "terminal-agent dist");
  await mkdir(destinationRoot, { recursive: true, mode: 0o755 });
  await assertRealDirectory(destinationRoot, "packaged terminal native runtime root");

  for (const relativePath of TERMINAL_NATIVE_RUNTIME_FILES) {
    await copyRuntimeFile(sourceRoot, destinationRoot, relativePath);
  }

  const verified = await assertPackagedTerminalNativeRuntime({ rootDir: root, platform, arch });
  return { ...verified, status: "PACKAGED" };
}

function parseCli(argv) {
  const input = { rootDir: undefined, ifBuilt: false };
  const args = [...argv];
  while (args.length > 0) {
    const key = args.shift();
    if (key === "--if-built") {
      input.ifBuilt = true;
      continue;
    }
    const value = args.shift();
    if (value === undefined) throw new Error("missing CLI value");
    if (key === "--root") input.rootDir = value;
    else throw new Error("unknown CLI argument");
  }
  if (input.rootDir === undefined) {
    throw new Error("usage: node tools/package-terminal-native-runtime.mjs --root <repo> [--if-built]");
  }
  return input;
}

async function main() {
  try {
    const result = await stageTerminalNativeRuntime(parseCli(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "terminal native runtime packaging failed";
    process.stderr.write(`${JSON.stringify({ status: "BLOCKED", error: message })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
