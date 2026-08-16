import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const PRODUCTION_CANDIDATE_SCHEMA = "dashboard-rpi5.production-candidate.v1";
export const PRODUCTION_CANDIDATE_HASH = "sha256";

export const PRODUCTION_CANDIDATE_DIRECTORY_ROOTS = Object.freeze([
  "apps/web/dist",
  "apps/server/dist",
  "apps/agent/dist",
  "apps/terminal-agent/dist",
  "packages/contracts/dist",
]);

export const PRODUCTION_CANDIDATE_FILE_ROOTS = Object.freeze([
  "package.json",
  "package-lock.json",
  "apps/web/package.json",
  "apps/server/package.json",
  "apps/agent/package.json",
  "apps/terminal-agent/package.json",
  "packages/contracts/package.json",
  "ops/production/launch-contract.json",
  "ops/production/web.env.example",
  "ops/production/terminal.env.example",
  "ops/production/smoke-contract.json",
  "ops/systemd/dashboard-rpi5-web.service",
  "ops/systemd/dashboard-rpi5-agent.service",
  "ops/systemd/dashboard-rpi5-terminal.socket",
  "ops/systemd/dashboard-rpi5-terminal@.service",
]);

const FULL_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function comparePath(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeRelative(rootDir, absolutePath) {
  const value = relative(rootDir, absolutePath);
  if (value === "" || value.startsWith(`..${sep}`) || value === ".." || isAbsolute(value)) {
    throw new Error("candidate path escaped repository root");
  }
  return value.split(sep).join("/");
}

async function sha256File(path) {
  const hash = createHash(PRODUCTION_CANDIDATE_HASH);
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function collectRegularFile(rootDir, absolutePath) {
  const fileStat = await lstat(absolutePath);
  if (fileStat.isSymbolicLink()) {
    throw new Error(`candidate symlink is forbidden: ${normalizeRelative(rootDir, absolutePath)}`);
  }
  if (!fileStat.isFile()) {
    throw new Error(`candidate entry must be a regular file: ${normalizeRelative(rootDir, absolutePath)}`);
  }
  return {
    path: normalizeRelative(rootDir, absolutePath),
    bytes: fileStat.size,
    sha256: await sha256File(absolutePath),
  };
}

async function collectDirectory(rootDir, absoluteDirectory) {
  const directoryStat = await lstat(absoluteDirectory);
  if (directoryStat.isSymbolicLink()) {
    throw new Error(`candidate symlink is forbidden: ${normalizeRelative(rootDir, absoluteDirectory)}`);
  }
  if (!directoryStat.isDirectory()) {
    throw new Error(`candidate directory root is not a directory: ${normalizeRelative(rootDir, absoluteDirectory)}`);
  }

  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  entries.sort((left, right) => comparePath(left.name, right.name));

  const files = [];
  for (const entry of entries) {
    const absolutePath = resolve(absoluteDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`candidate symlink is forbidden: ${normalizeRelative(rootDir, absolutePath)}`);
    }
    if (entry.isDirectory()) {
      files.push(...(await collectDirectory(rootDir, absolutePath)));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`candidate entry must be a regular file: ${normalizeRelative(rootDir, absolutePath)}`);
    }
    files.push(await collectRegularFile(rootDir, absolutePath));
  }
  return files;
}

function validateSourceSha(sourceSha) {
  if (!FULL_SHA.test(sourceSha)) {
    throw new Error("source SHA must be 40 lowercase hexadecimal characters");
  }
}

function manifestCore(sourceSha, files) {
  const totalBytes = files.reduce((total, file) => total + file.bytes, 0);
  return {
    schema: PRODUCTION_CANDIDATE_SCHEMA,
    sourceSha,
    releasePath: `/opt/dashboard_RPi5/releases/${sourceSha}`,
    nodeMajor: 24,
    hashAlgorithm: PRODUCTION_CANDIDATE_HASH,
    fileCount: files.length,
    totalBytes,
    files,
  };
}

function digestManifestCore(core) {
  return createHash(PRODUCTION_CANDIDATE_HASH).update(JSON.stringify(core), "utf8").digest("hex");
}

export async function createProductionCandidateManifest({ rootDir, sourceSha }) {
  validateSourceSha(sourceSha);
  const root = resolve(rootDir);
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("candidate repository root must be a real directory");
  }

  const files = [];
  for (const relativeDirectory of PRODUCTION_CANDIDATE_DIRECTORY_ROOTS) {
    files.push(...(await collectDirectory(root, resolve(root, relativeDirectory))));
  }
  for (const relativeFile of PRODUCTION_CANDIDATE_FILE_ROOTS) {
    files.push(await collectRegularFile(root, resolve(root, relativeFile)));
  }

  files.sort((left, right) => comparePath(left.path, right.path));
  const seen = new Set();
  for (const file of files) {
    if (seen.has(file.path)) throw new Error(`duplicate candidate path: ${file.path}`);
    seen.add(file.path);
  }

  const core = manifestCore(sourceSha, files);
  return {
    ...core,
    candidateSha256: digestManifestCore(core),
  };
}

export function validateCandidateManifestShape(manifest, expectedSha) {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new Error("candidate manifest must be an object");
  }
  if (manifest.schema !== PRODUCTION_CANDIDATE_SCHEMA) throw new Error("candidate manifest schema mismatch");
  if (manifest.sourceSha !== expectedSha) throw new Error("candidate manifest source SHA mismatch");
  validateSourceSha(manifest.sourceSha);
  if (manifest.releasePath !== `/opt/dashboard_RPi5/releases/${expectedSha}`) {
    throw new Error("candidate manifest release path mismatch");
  }
  if (manifest.nodeMajor !== 24) throw new Error("candidate manifest Node major mismatch");
  if (manifest.hashAlgorithm !== PRODUCTION_CANDIDATE_HASH) throw new Error("candidate manifest hash algorithm mismatch");
  if (!Number.isSafeInteger(manifest.fileCount) || manifest.fileCount < 1) throw new Error("candidate manifest file count is invalid");
  if (!Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0) throw new Error("candidate manifest total bytes is invalid");
  if (!Array.isArray(manifest.files)) throw new Error("candidate manifest files must be an array");
  if (!SHA256.test(manifest.candidateSha256 ?? "")) throw new Error("candidate manifest digest is invalid");
}

export async function verifyProductionCandidateManifest({ rootDir, sourceSha, manifest }) {
  validateCandidateManifestShape(manifest, sourceSha);
  const expected = await createProductionCandidateManifest({ rootDir, sourceSha });
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) {
    throw new Error("candidate manifest does not match exact build contents");
  }
  return expected;
}

function parseCli(argv) {
  const args = [...argv];
  let rootDir;
  let sourceSha;
  let verifyPath;
  while (args.length > 0) {
    const key = args.shift();
    const value = args.shift();
    if (value === undefined) throw new Error("missing CLI value");
    if (key === "--root") rootDir = value;
    else if (key === "--sha") sourceSha = value;
    else if (key === "--verify") verifyPath = value;
    else throw new Error("unknown CLI argument");
  }
  if (rootDir === undefined || sourceSha === undefined) {
    throw new Error("usage: node tools/production-candidate-manifest.mjs --root <repo> --sha <40-hex-sha> [--verify <manifest.json>]");
  }
  return { rootDir, sourceSha, verifyPath };
}

async function main() {
  let input;
  try {
    input = parseCli(process.argv.slice(2));
    if (input.verifyPath === undefined) {
      const manifest = await createProductionCandidateManifest(input);
      process.stdout.write(`${JSON.stringify(manifest)}\n`);
      return;
    }

    const rawManifest = await readFile(resolve(input.verifyPath), "utf8");
    const manifest = JSON.parse(rawManifest);
    const verified = await verifyProductionCandidateManifest({
      rootDir: input.rootDir,
      sourceSha: input.sourceSha,
      manifest,
    });
    process.stdout.write(`${JSON.stringify({ status: "PASS", sourceSha: verified.sourceSha, candidateSha256: verified.candidateSha256 })}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "candidate manifest failed";
    process.stderr.write(`${JSON.stringify({ status: "BLOCKED", error: message })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
