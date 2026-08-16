import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  PRODUCTION_CANDIDATE_HASH,
  PRODUCTION_CANDIDATE_SCHEMA,
  verifyInstalledProductionCandidateManifest,
  verifyProductionCandidateManifest,
} from "./production-candidate-manifest.mjs";

export const RELEASE_ACTIVATION_SCHEMA = "dashboard-rpi5.release-activation.v1";
export const RELEASE_ACTIVATION_ACK = "I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ACTIVATION";
export const RELEASE_ROLLBACK_ACK = "I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ROLLBACK";

const PRODUCTION_ROOT = "/opt/dashboard_RPi5";
const APPLY_LOCK_NAME = ".dashboard-release-controller.lock";
const MANIFEST_MARKER = ".dashboard-production-candidate.json";
const FULL_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

function assertObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertSha(value, label = "source SHA") {
  if (typeof value !== "string" || !FULL_SHA.test(value)) {
    throw new Error(`${label} must be 40 lowercase hexadecimal characters`);
  }
  return value;
}

function isWithin(root, candidate) {
  const value = relative(root, candidate);
  return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

function assertRealDirectoryStat(stat, label) {
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory`);
  }
}

async function ensureRealDirectory(path, label, create = false) {
  let stat = await pathState(path);
  if (stat === null && create) {
    try {
      await mkdir(path, { mode: 0o755 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    stat = await pathState(path);
  }
  if (stat === null) throw new Error(`${label} is missing`);
  assertRealDirectoryStat(stat, label);
}

function validateManifestEntry(entry) {
  const value = assertObject(entry, "candidate manifest file");
  if (typeof value.path !== "string" || value.path === "" || value.path.startsWith("/") || value.path.includes("\\")) {
    throw new Error("candidate manifest file path is invalid");
  }
  const segments = value.path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("candidate manifest file path escapes release root");
  }
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0) throw new Error("candidate manifest file size is invalid");
  if (typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) throw new Error("candidate manifest file digest is invalid");
  return value;
}

export function validateReleaseActivationContract(contractValue) {
  const contract = assertObject(contractValue, "release activation contract");
  if (contract.schema !== RELEASE_ACTIVATION_SCHEMA || contract.sourceOnly !== true) {
    throw new Error("release activation contract schema/source boundary mismatch");
  }
  if (
    contract.productionRoot !== PRODUCTION_ROOT ||
    contract.releasesRoot !== `${PRODUCTION_ROOT}/releases` ||
    contract.currentLink !== `${PRODUCTION_ROOT}/current` ||
    contract.applyLock !== `${PRODUCTION_ROOT}/${APPLY_LOCK_NAME}`
  ) {
    throw new Error("release activation production path mismatch");
  }
  if (contract.manifestMarker !== MANIFEST_MARKER || contract.candidateManifestSchema !== PRODUCTION_CANDIDATE_SCHEMA) {
    throw new Error("release activation manifest contract mismatch");
  }
  if (contract.releaseDirectory !== "exact-source-sha" || contract.currentLinkTargetStyle !== "relative-release-path") {
    throw new Error("release activation path style mismatch");
  }
  if (
    contract.atomicPointerSwap !== true ||
    contract.exclusiveApplyLock !== true ||
    contract.staleLockAutoCleanup !== false ||
    contract.retainPreviousRelease !== true ||
    contract.deleteReleaseDuringActivation !== false
  ) {
    throw new Error("release activation atomic/retention invariant mismatch");
  }
  if (
    contract.networkAllowed !== false ||
    contract.processExecutionAllowed !== false ||
    contract.systemdMutationAllowed !== false ||
    contract.identityMutationAllowed !== false ||
    contract.cloudflareMutationAllowed !== false
  ) {
    throw new Error("release activation forbidden capability enabled");
  }
  const capabilities = assertObject(contract.baseCapabilities, "base capability contract");
  if (capabilities.quickCommands !== "disabled" || capabilities.terminal !== "disabled") {
    throw new Error("base launch capabilities must remain disabled");
  }
  const applyGate = assertObject(contract.applyGate, "apply gate");
  if (applyGate.flag !== "--apply" || applyGate.acknowledgement !== RELEASE_ACTIVATION_ACK || applyGate.requiresExpectedCurrent !== true) {
    throw new Error("release activation apply gate mismatch");
  }
  const rollbackGate = assertObject(contract.rollbackGate, "rollback gate");
  if (
    rollbackGate.flag !== "--apply" ||
    rollbackGate.acknowledgement !== RELEASE_ROLLBACK_ACK ||
    rollbackGate.requiresExpectedCurrent !== true ||
    rollbackGate.requiresVerifiedExistingRelease !== true
  ) {
    throw new Error("release activation rollback gate mismatch");
  }
  return contract;
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

async function readJsonBounded(path, label) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_MANIFEST_BYTES) {
    throw new Error(`${label} must be a bounded regular file`);
  }
  return JSON.parse(await readFile(path, "utf8"));
}

async function pathState(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function inspectCurrent(activationRoot) {
  const root = resolve(activationRoot);
  const rootStat = await pathState(root);
  if (rootStat === null) return null;
  assertRealDirectoryStat(rootStat, "activation root");

  const currentPath = resolve(root, "current");
  const stat = await pathState(currentPath);
  if (stat === null) return null;
  if (!stat.isSymbolicLink()) throw new Error("current pointer exists but is not a symbolic link");
  const target = await readlink(currentPath);
  if (isAbsolute(target)) throw new Error("current pointer must use a relative release target");
  const match = /^releases\/([0-9a-f]{40})$/u.exec(target);
  if (match === null) throw new Error("current pointer target is outside the reviewed release shape");
  const sha = match[1];
  const expected = resolve(root, "releases", sha);
  if (resolve(dirname(currentPath), target) !== expected) throw new Error("current pointer target escaped releases root");
  return sha;
}

async function verifyManifestFileAgainstEntry(path, entry) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`release file must be regular: ${entry.path}`);
  if (stat.size !== entry.bytes) throw new Error(`release file size mismatch: ${entry.path}`);
  if ((await sha256File(path)) !== entry.sha256) throw new Error(`release file digest mismatch: ${entry.path}`);
}

async function assertInstalledReleaseRoots(activationRoot) {
  const root = resolve(activationRoot);
  await ensureRealDirectory(root, "activation root");
  await ensureRealDirectory(resolve(root, "releases"), "releases root");
}

async function readInstalledManifest(activationRoot, sourceSha) {
  assertSha(sourceSha);
  await assertInstalledReleaseRoots(activationRoot);
  const releaseDir = resolve(activationRoot, "releases", sourceSha);
  const releaseStat = await pathState(releaseDir);
  if (releaseStat === null || releaseStat.isSymbolicLink() || !releaseStat.isDirectory()) {
    throw new Error("verified release directory is missing or invalid");
  }
  const markerPath = resolve(releaseDir, MANIFEST_MARKER);
  const manifest = await readJsonBounded(markerPath, "installed candidate manifest");
  await verifyInstalledProductionCandidateManifest({ rootDir: releaseDir, sourceSha, manifest });
  return manifest;
}

async function inspectTargetRelease(activationRoot, sourceSha) {
  const root = resolve(activationRoot);
  const rootStat = await pathState(root);
  if (rootStat === null) return { exists: false, manifest: null };
  assertRealDirectoryStat(rootStat, "activation root");

  const releasesRoot = resolve(root, "releases");
  const releasesStat = await pathState(releasesRoot);
  if (releasesStat === null) return { exists: false, manifest: null };
  assertRealDirectoryStat(releasesStat, "releases root");

  const releaseDir = resolve(releasesRoot, sourceSha);
  const stat = await pathState(releaseDir);
  if (stat === null) return { exists: false, manifest: null };
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("target release path exists but is not a real directory");
  return { exists: true, manifest: await readInstalledManifest(activationRoot, sourceSha) };
}

function expectedCurrentLabel(value) {
  return value === null ? "none" : value;
}

function normalizeExpectedCurrent(expected) {
  if (expected === undefined) throw new Error("expected current release is required for apply");
  return expected === "none" ? null : assertSha(expected, "expected current SHA");
}

function assertExpectedCurrent(observed, expected) {
  const normalized = normalizeExpectedCurrent(expected);
  if (observed !== normalized) throw new Error("current release changed since reviewed plan");
  return normalized;
}

async function assertCurrentUnchanged(activationRoot, reviewedCurrent) {
  const current = await inspectCurrent(activationRoot);
  if (current !== reviewedCurrent) throw new Error("current release changed during activation");
}

async function loadAndVerifyCandidate({ candidateRoot, manifestPath, sourceSha }) {
  assertSha(sourceSha);
  const manifest = await readJsonBounded(resolve(manifestPath), "candidate manifest");
  return verifyProductionCandidateManifest({
    rootDir: resolve(candidateRoot),
    sourceSha,
    manifest,
  });
}

export async function planReleaseActivation({ activationRoot, candidateRoot, manifestPath, sourceSha, contract }) {
  validateReleaseActivationContract(contract);
  const verified = await loadAndVerifyCandidate({ candidateRoot, manifestPath, sourceSha });
  const observedCurrent = await inspectCurrent(activationRoot);
  if (observedCurrent !== null) await readInstalledManifest(activationRoot, observedCurrent);
  const target = await inspectTargetRelease(activationRoot, sourceSha);
  const operations = [];
  if (!target.exists) operations.push("copy_manifest_allowlisted_release", "write_verified_manifest_marker");
  if (observedCurrent !== sourceSha) operations.push("atomic_current_symlink_swap");
  return {
    status: "PLAN",
    action: "activate",
    sourceSha,
    candidateSha256: verified.candidateSha256,
    observedCurrent: expectedCurrentLabel(observedCurrent),
    targetRelease: target.exists ? "verified-existing" : "absent",
    operations,
  };
}

async function ensureReleaseParentDirectories(releaseDir, entryPath) {
  const segments = entryPath.split("/").slice(0, -1);
  let current = releaseDir;
  for (const segment of segments) {
    current = resolve(current, segment);
    await ensureRealDirectory(current, `release directory ${segment}`, true);
  }
}

async function copyVerifiedRelease({ activationRoot, candidateRoot, manifest }) {
  const root = resolve(activationRoot);
  await ensureRealDirectory(root, "activation root");
  const releasesRoot = resolve(root, "releases");
  await ensureRealDirectory(releasesRoot, "releases root", true);
  const releaseDir = resolve(releasesRoot, manifest.sourceSha);
  if (!isWithin(root, releaseDir)) throw new Error("release destination escaped activation root");

  try {
    await mkdir(releaseDir, { mode: 0o755 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("target release appeared after reviewed plan", { cause: error });
    throw error;
  }
  await ensureRealDirectory(releaseDir, "target release directory");

  for (const rawEntry of manifest.files) {
    const entry = validateManifestEntry(rawEntry);
    const sourcePath = resolve(candidateRoot, ...entry.path.split("/"));
    const destinationPath = resolve(releaseDir, ...entry.path.split("/"));
    if (!isWithin(resolve(candidateRoot), sourcePath) || !isWithin(releaseDir, destinationPath)) {
      throw new Error("manifest path escaped reviewed roots");
    }
    await verifyManifestFileAgainstEntry(sourcePath, entry);
    await ensureReleaseParentDirectories(releaseDir, entry.path);
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
    await verifyManifestFileAgainstEntry(destinationPath, entry);
  }

  await verifyProductionCandidateManifest({ rootDir: releaseDir, sourceSha: manifest.sourceSha, manifest });
  const markerPath = resolve(releaseDir, MANIFEST_MARKER);
  await writeFile(markerPath, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await readInstalledManifest(activationRoot, manifest.sourceSha);
}

async function swapCurrentPointer(activationRoot, sourceSha) {
  assertSha(sourceSha);
  const root = resolve(activationRoot);
  await ensureRealDirectory(root, "activation root");
  const currentPath = resolve(root, "current");
  const temporary = resolve(root, `.current.next-${sourceSha}-${randomUUID()}`);
  const target = `releases/${sourceSha}`;
  await symlink(target, temporary);
  try {
    await rename(temporary, currentPath);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") throw cleanupError;
    }
    throw error;
  }
}

async function withExclusiveApplyLock(activationRoot, operation) {
  const root = resolve(activationRoot);
  await ensureRealDirectory(root, "activation root", true);
  const lockPath = resolve(root, APPLY_LOCK_NAME);
  let lockHandle;
  try {
    lockHandle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("release controller apply lock already exists; inspect evidence before explicit cleanup", { cause: error });
    }
    throw error;
  }

  let result;
  let operationError;
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  }

  let cleanupError;
  try {
    await lockHandle.close();
  } catch (error) {
    cleanupError = error;
  }
  try {
    await unlink(lockPath);
  } catch (error) {
    if (error?.code !== "ENOENT" && cleanupError === undefined) cleanupError = error;
  }

  if (operationError !== undefined) {
    if (cleanupError !== undefined) {
      throw new Error("release operation failed and apply lock cleanup also failed", { cause: operationError });
    }
    throw operationError;
  }
  if (cleanupError !== undefined) throw cleanupError;
  return result;
}

export async function applyReleaseActivation({ activationRoot, candidateRoot, manifestPath, sourceSha, expectedCurrent, contract }) {
  await planReleaseActivation({ activationRoot, candidateRoot, manifestPath, sourceSha, contract });
  return withExclusiveApplyLock(activationRoot, async () => {
    const plan = await planReleaseActivation({ activationRoot, candidateRoot, manifestPath, sourceSha, contract });
    const observed = plan.observedCurrent === "none" ? null : plan.observedCurrent;
    assertExpectedCurrent(observed, expectedCurrent);
    const manifest = await loadAndVerifyCandidate({ candidateRoot, manifestPath, sourceSha });
    const target = await inspectTargetRelease(activationRoot, sourceSha);
    if (!target.exists) await copyVerifiedRelease({ activationRoot, candidateRoot: resolve(candidateRoot), manifest });
    await assertCurrentUnchanged(activationRoot, observed);
    if (observed !== sourceSha) await swapCurrentPointer(activationRoot, sourceSha);
    const finalCurrent = await inspectCurrent(activationRoot);
    if (finalCurrent !== sourceSha) throw new Error("current pointer did not activate exact source SHA");
    await readInstalledManifest(activationRoot, sourceSha);
    return {
      status: "APPLIED",
      action: "activate",
      sourceSha,
      candidateSha256: manifest.candidateSha256,
      previousRelease: expectedCurrentLabel(observed),
      currentRelease: sourceSha,
      releasesDeleted: 0,
    };
  });
}

export async function planReleaseRollback({ activationRoot, rollbackSha, contract }) {
  validateReleaseActivationContract(contract);
  assertSha(rollbackSha, "rollback SHA");
  const observedCurrent = await inspectCurrent(activationRoot);
  if (observedCurrent === null) throw new Error("rollback requires an existing current release");
  await readInstalledManifest(activationRoot, observedCurrent);
  const manifest = await readInstalledManifest(activationRoot, rollbackSha);
  return {
    status: "PLAN",
    action: "rollback",
    rollbackSha,
    rollbackCandidateSha256: manifest.candidateSha256,
    observedCurrent,
    operations: observedCurrent === rollbackSha ? [] : ["atomic_current_symlink_swap"],
  };
}

export async function applyReleaseRollback({ activationRoot, rollbackSha, expectedCurrent, contract }) {
  await planReleaseRollback({ activationRoot, rollbackSha, contract });
  return withExclusiveApplyLock(activationRoot, async () => {
    const plan = await planReleaseRollback({ activationRoot, rollbackSha, contract });
    const reviewedCurrent = assertExpectedCurrent(plan.observedCurrent, expectedCurrent);
    await assertCurrentUnchanged(activationRoot, reviewedCurrent);
    if (reviewedCurrent !== rollbackSha) await swapCurrentPointer(activationRoot, rollbackSha);
    const finalCurrent = await inspectCurrent(activationRoot);
    if (finalCurrent !== rollbackSha) throw new Error("rollback pointer did not activate exact target SHA");
    await readInstalledManifest(activationRoot, rollbackSha);
    return {
      status: "ROLLED_BACK",
      action: "rollback",
      previousRelease: reviewedCurrent,
      currentRelease: rollbackSha,
      releasesDeleted: 0,
    };
  });
}

function parseCli(argv) {
  const args = [...argv];
  const input = { apply: false };
  while (args.length > 0) {
    const key = args.shift();
    if (key === "--apply") {
      input.apply = true;
      continue;
    }
    const value = args.shift();
    if (value === undefined) throw new Error("missing CLI value");
    if (key === "--candidate-root") input.candidateRoot = value;
    else if (key === "--manifest") input.manifestPath = value;
    else if (key === "--sha") input.sourceSha = value;
    else if (key === "--rollback") input.rollbackSha = value;
    else if (key === "--expected-current") input.expectedCurrent = value;
    else if (key === "--ack") input.ack = value;
    else throw new Error("unknown CLI argument");
  }
  if (input.rollbackSha !== undefined && input.sourceSha !== undefined) throw new Error("activate and rollback modes are mutually exclusive");
  return input;
}

async function main() {
  try {
    const input = parseCli(process.argv.slice(2));
    const contractPath = resolve("ops/production/release-activation-contract.json");
    const contract = validateReleaseActivationContract(await readJsonBounded(contractPath, "release activation contract"));

    if (input.rollbackSha !== undefined) {
      if (!input.apply) {
        const result = await planReleaseRollback({ activationRoot: PRODUCTION_ROOT, rollbackSha: input.rollbackSha, contract });
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return;
      }
      if (input.ack !== RELEASE_ROLLBACK_ACK) throw new Error("rollback owner acknowledgement mismatch");
      const result = await applyReleaseRollback({
        activationRoot: PRODUCTION_ROOT,
        rollbackSha: input.rollbackSha,
        expectedCurrent: input.expectedCurrent,
        contract,
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }

    if (input.candidateRoot === undefined || input.manifestPath === undefined || input.sourceSha === undefined) {
      throw new Error("activation requires --candidate-root, --manifest and --sha");
    }
    if (!input.apply) {
      const result = await planReleaseActivation({
        activationRoot: PRODUCTION_ROOT,
        candidateRoot: input.candidateRoot,
        manifestPath: input.manifestPath,
        sourceSha: input.sourceSha,
        contract,
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    if (input.ack !== RELEASE_ACTIVATION_ACK) throw new Error("activation owner acknowledgement mismatch");
    const result = await applyReleaseActivation({
      activationRoot: PRODUCTION_ROOT,
      candidateRoot: input.candidateRoot,
      manifestPath: input.manifestPath,
      sourceSha: input.sourceSha,
      expectedCurrent: input.expectedCurrent,
      contract,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "production release controller failed";
    process.stderr.write(`${JSON.stringify({ status: "BLOCKED", error: message })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
