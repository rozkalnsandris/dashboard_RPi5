import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  chmod,
  chown,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  realpath,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  PRODUCTION_CANDIDATE_HASH,
  PRODUCTION_CANDIDATE_SCHEMA,
  validateCandidateManifestShape,
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
const RELEASE_DIRECTORY_MODE = 0o755;
const RELEASE_REGULAR_FILE_MODE = 0o644;
const PREVERIFICATION_DESTINATION_MODE = 0o600;
const MANIFEST_MARKER_MODE = 0o600;
const ROOT_UID = 0;
const ROOT_GID = 0;
const SECURE_COPY_BUFFER_BYTES = 64 * 1024;
const PROC_SELF_FD = "/proc/self/fd";
const MODULE_FILE = fileURLToPath(import.meta.url);
const MODULE_ROOT = resolve(dirname(MODULE_FILE), "..");

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

function assertSha256(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be 64 lowercase hexadecimal characters`);
  }
  return value;
}

function comparePath(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
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

function modeOf(stat) {
  return stat.mode & 0o777;
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
  if (value.path === MANIFEST_MARKER || segments.includes("node_modules")) {
    throw new Error("candidate manifest file path is reserved");
  }
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0) throw new Error("candidate manifest file size is invalid");
  if (typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) throw new Error("candidate manifest file digest is invalid");
  return value;
}

function validateManifestForPrivilegedConsumption(manifest, sourceSha) {
  validateCandidateManifestShape(manifest, sourceSha);
  if (manifest.files.length !== manifest.fileCount) throw new Error("candidate manifest file count mismatch");
  const files = manifest.files.map((entry) => validateManifestEntry(entry));
  const paths = files.map((entry) => entry.path);
  const sorted = [...paths].sort(comparePath);
  if (JSON.stringify(paths) !== JSON.stringify(sorted)) throw new Error("candidate manifest files are not deterministically sorted");
  if (new Set(paths).size !== paths.length) throw new Error("candidate manifest contains duplicate paths");
  const totalBytes = files.reduce((total, entry) => total + entry.bytes, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes !== manifest.totalBytes) {
    throw new Error("candidate manifest total bytes mismatch");
  }
  const core = {
    schema: manifest.schema,
    sourceSha: manifest.sourceSha,
    releasePath: manifest.releasePath,
    nodeMajor: manifest.nodeMajor,
    hashAlgorithm: manifest.hashAlgorithm,
    fileCount: files.length,
    totalBytes,
    files,
  };
  const digest = createHash(PRODUCTION_CANDIDATE_HASH).update(JSON.stringify(core), "utf8").digest("hex");
  if (digest !== manifest.candidateSha256) throw new Error("candidate manifest digest mismatch");
  return { ...manifest, files };
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
  const releaseMetadata = assertObject(contract.releaseMetadata, "release metadata contract");
  if (
    releaseMetadata.owner !== "root" ||
    releaseMetadata.group !== "root" ||
    releaseMetadata.directoryMode !== "0755" ||
    releaseMetadata.regularFileMode !== "0644" ||
    releaseMetadata.manifestMarkerMode !== "0600" ||
    releaseMetadata.callerUmaskIndependent !== true
  ) {
    throw new Error("release activation metadata invariant mismatch");
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
  if (
    applyGate.flag !== "--apply" ||
    applyGate.acknowledgement !== RELEASE_ACTIVATION_ACK ||
    applyGate.requiresExpectedCurrent !== true ||
    applyGate.requiresExpectedCandidateSha256 !== true
  ) {
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

function assertDescriptorSafetyAvailable() {
  if (process.platform !== "linux") throw new Error("descriptor-safe candidate consumption requires Linux");
  for (const name of ["O_DIRECTORY", "O_NOFOLLOW", "O_NONBLOCK"]) {
    if (!Number.isInteger(constants[name])) throw new Error(`descriptor-safe candidate consumption requires ${name}`);
  }
}

function descriptorChildPath(handle, child) {
  return `${PROC_SELF_FD}/${handle.fd}/${child}`;
}

async function closeIgnoringError(handle) {
  if (handle === undefined) return;
  try {
    await handle.close();
  } catch {
    // Best-effort descriptor cleanup only. The original operation error remains authoritative.
  }
}

async function openDirectoryChild(parentHandle, segment, label) {
  let handle;
  try {
    handle = await open(
      descriptorChildPath(parentHandle, segment),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const stat = await handle.stat();
    if (!stat.isDirectory()) throw new Error(`${label} must be a real directory`);
    return handle;
  } catch (error) {
    await closeIgnoringError(handle);
    if (error instanceof Error && error.message === `${label} must be a real directory`) throw error;
    throw new Error(`${label} must be a real non-symlink directory`, { cause: error });
  }
}

async function openAnchoredDirectory(absoluteDirectory, label) {
  assertDescriptorSafetyAvailable();
  const resolved = resolve(absoluteDirectory);
  if (!isAbsolute(resolved)) throw new Error(`${label} must be absolute`);
  let handle = await open("/", constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const segment of resolved.split(sep).filter(Boolean)) {
      const next = await openDirectoryChild(handle, segment, label);
      await handle.close();
      handle = next;
    }
    return handle;
  } catch (error) {
    await closeIgnoringError(handle);
    throw error;
  }
}

async function openAnchoredRegularFile(absolutePath, label, extraFlags = 0) {
  const resolved = resolve(absolutePath);
  const parentHandle = await openAnchoredDirectory(dirname(resolved), `${label} parent`);
  let fileHandle;
  try {
    const name = resolved.slice(dirname(resolved).length + (dirname(resolved) === "/" ? 0 : 1));
    if (name === "" || name.includes(sep)) throw new Error(`${label} filename is invalid`);
    try {
      fileHandle = await open(
        descriptorChildPath(parentHandle, name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | extraFlags,
      );
    } catch (error) {
      throw new Error(`${label} must be a real non-symlink regular file`, { cause: error });
    }
    const stat = await fileHandle.stat();
    if (!stat.isFile()) throw new Error(`${label} must be a real non-symlink regular file`);
    return { handle: fileHandle, stat };
  } catch (error) {
    await closeIgnoringError(fileHandle);
    throw error;
  } finally {
    await parentHandle.close();
  }
}

async function readHandleBounded(handle, maximumBytes, label) {
  const chunks = [];
  let total = 0;
  let position = 0;
  while (true) {
    const remaining = maximumBytes + 1 - total;
    if (remaining <= 0) throw new Error(`${label} exceeds maximum size`);
    const buffer = Buffer.allocUnsafe(Math.min(SECURE_COPY_BUFFER_BYTES, remaining));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maximumBytes) throw new Error(`${label} exceeds maximum size`);
    position += bytesRead;
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
  }
  return Buffer.concat(chunks, total);
}

async function readCandidateManifestBounded(path, sourceSha) {
  const { handle, stat } = await openAnchoredRegularFile(resolve(path), "candidate manifest");
  try {
    if (stat.size > MAX_MANIFEST_BYTES) throw new Error("candidate manifest must be a bounded regular file");
    const bytes = await readHandleBounded(handle, MAX_MANIFEST_BYTES, "candidate manifest");
    const finalStat = await handle.stat();
    if (!finalStat.isFile() || finalStat.size !== bytes.length) {
      throw new Error("candidate manifest changed while being read");
    }
    return validateManifestForPrivilegedConsumption(JSON.parse(bytes.toString("utf8")), sourceSha);
  } finally {
    await handle.close();
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

function assertExpectedCandidateSha256(observed, expected) {
  const normalized = assertSha256(expected, "expected candidate SHA-256");
  if (observed !== normalized) throw new Error("candidate manifest changed since reviewed plan");
  return normalized;
}

async function assertCurrentUnchanged(activationRoot, reviewedCurrent) {
  const current = await inspectCurrent(activationRoot);
  if (current !== reviewedCurrent) throw new Error("current release changed during activation");
}

function isProductionActivationRoot(activationRoot) {
  return resolve(activationRoot) === PRODUCTION_ROOT;
}

async function assertTrustedProductionControllerEntrypoint() {
  if (typeof process.geteuid !== "function" || process.geteuid() !== ROOT_UID) {
    throw new Error("production release apply requires root through the trusted controller boundary");
  }
  const modulePath = await realpath(MODULE_FILE);
  const releasesRoot = resolve(PRODUCTION_ROOT, "releases");
  const moduleRelative = relative(releasesRoot, modulePath);
  const segments = moduleRelative.split(sep);
  if (
    moduleRelative === "" ||
    moduleRelative === ".." ||
    moduleRelative.startsWith(`..${sep}`) ||
    isAbsolute(moduleRelative) ||
    segments.length !== 3 ||
    !FULL_SHA.test(segments[0]) ||
    segments[1] !== "tools" ||
    segments[2] !== "production-release-controller.mjs"
  ) {
    throw new Error("production apply must execute the controller from the current root-owned immutable release");
  }
  const releaseSha = segments[0];
  const releaseDir = resolve(releasesRoot, releaseSha);
  const releaseStat = await lstat(releaseDir);
  const controllerStat = await lstat(modulePath);
  if (
    releaseStat.isSymbolicLink() ||
    !releaseStat.isDirectory() ||
    releaseStat.uid !== ROOT_UID ||
    releaseStat.gid !== ROOT_GID ||
    modeOf(releaseStat) !== RELEASE_DIRECTORY_MODE
  ) {
    throw new Error("trusted controller release directory metadata is unsafe");
  }
  if (
    controllerStat.isSymbolicLink() ||
    !controllerStat.isFile() ||
    controllerStat.uid !== ROOT_UID ||
    controllerStat.gid !== ROOT_GID ||
    modeOf(controllerStat) !== RELEASE_REGULAR_FILE_MODE
  ) {
    throw new Error("trusted production release controller metadata is unsafe");
  }
  const current = await inspectCurrent(PRODUCTION_ROOT);
  if (current !== releaseSha) throw new Error("production apply controller must come from the current release");
  await readInstalledManifest(PRODUCTION_ROOT, releaseSha);
  return releaseSha;
}

function assertProductionPlanRunsUnprivileged(activationRoot) {
  if (
    isProductionActivationRoot(activationRoot) &&
    typeof process.geteuid === "function" &&
    process.geteuid() === ROOT_UID
  ) {
    throw new Error("production candidate planning must run without root privileges");
  }
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
  assertProductionPlanRunsUnprivileged(activationRoot);
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

async function preparePrivilegedActivation({ activationRoot, candidateRoot, manifestPath, sourceSha, expectedCandidateSha256, contract }) {
  validateReleaseActivationContract(contract);
  assertSha(sourceSha);
  const candidateRootResolved = resolve(candidateRoot);
  const manifest = await readCandidateManifestBounded(manifestPath, sourceSha);
  assertExpectedCandidateSha256(manifest.candidateSha256, expectedCandidateSha256);
  const observedCurrent = await inspectCurrent(activationRoot);
  if (observedCurrent !== null) await readInstalledManifest(activationRoot, observedCurrent);
  const target = await inspectTargetRelease(activationRoot, sourceSha);
  if (target.exists && target.manifest?.candidateSha256 !== manifest.candidateSha256) {
    throw new Error("existing target release does not match reviewed candidate manifest");
  }
  return { candidateRoot: candidateRootResolved, manifest, observedCurrent, target };
}

async function normalizeInstalledReleasePath(path, mode, activationRoot) {
  if (resolve(activationRoot) === PRODUCTION_ROOT) {
    if (typeof process.geteuid !== "function" || process.geteuid() !== ROOT_UID) {
      throw new Error("production release metadata normalization requires root");
    }
    await chown(path, ROOT_UID, ROOT_GID);
  }
  await chmod(path, mode);
}

async function ensureReleaseParentDirectories(releaseDir, entryPath, activationRoot) {
  const segments = entryPath.split("/").slice(0, -1);
  let current = releaseDir;
  for (const segment of segments) {
    current = resolve(current, segment);
    await ensureRealDirectory(current, `release directory ${segment}`, true);
    await normalizeInstalledReleasePath(current, RELEASE_DIRECTORY_MODE, activationRoot);
  }
}

export async function openVerifiedCandidateSource({ candidateRoot, entry: rawEntry }) {
  const entry = validateManifestEntry(rawEntry);
  const candidateRootResolved = resolve(candidateRoot);
  let directoryHandle = await openAnchoredDirectory(candidateRootResolved, "candidate root");
  let sourceHandle;
  try {
    const segments = entry.path.split("/");
    for (const segment of segments.slice(0, -1)) {
      const next = await openDirectoryChild(directoryHandle, segment, `candidate directory ${segment}`);
      await directoryHandle.close();
      directoryHandle = next;
    }
    const filename = segments.at(-1);
    try {
      sourceHandle = await open(
        descriptorChildPath(directoryHandle, filename),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      throw new Error(`candidate source must be a real non-symlink regular file: ${entry.path}`, { cause: error });
    }
    const stat = await sourceHandle.stat();
    if (!stat.isFile()) throw new Error(`candidate source must be a regular file: ${entry.path}`);
    if (stat.size !== entry.bytes) throw new Error(`candidate source size mismatch: ${entry.path}`);
    return sourceHandle;
  } catch (error) {
    await closeIgnoringError(sourceHandle);
    throw error;
  } finally {
    await directoryHandle.close();
  }
}

async function writeAll(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, position + offset);
    if (bytesWritten <= 0) throw new Error("release destination write made no progress");
    offset += bytesWritten;
  }
}

export async function copyVerifiedCandidateSourceHandle({ sourceHandle, destinationPath, entry: rawEntry }) {
  const entry = validateManifestEntry(rawEntry);
  const sourceBefore = await sourceHandle.stat();
  if (!sourceBefore.isFile()) throw new Error(`candidate source must remain a regular file: ${entry.path}`);
  if (sourceBefore.size !== entry.bytes) throw new Error(`candidate source size mismatch: ${entry.path}`);

  let destinationHandle;
  try {
    destinationHandle = await open(
      destinationPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      PREVERIFICATION_DESTINATION_MODE,
    );
    const hash = createHash(PRODUCTION_CANDIDATE_HASH);
    const buffer = Buffer.allocUnsafe(SECURE_COPY_BUFFER_BYTES);
    let total = 0;
    let position = 0;
    while (true) {
      const maximumRead = Math.min(buffer.length, entry.bytes - total + 1);
      if (maximumRead <= 0) throw new Error(`candidate source size mismatch: ${entry.path}`);
      const { bytesRead } = await sourceHandle.read(buffer, 0, maximumRead, position);
      if (bytesRead === 0) break;
      if (total + bytesRead > entry.bytes) throw new Error(`candidate source size mismatch: ${entry.path}`);
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      await writeAll(destinationHandle, chunk, total);
      total += bytesRead;
      position += bytesRead;
    }
    if (total !== entry.bytes) throw new Error(`candidate source size mismatch: ${entry.path}`);
    if (hash.digest("hex") !== entry.sha256) throw new Error(`candidate source digest mismatch: ${entry.path}`);
    const sourceAfter = await sourceHandle.stat();
    if (!sourceAfter.isFile() || sourceAfter.size !== entry.bytes) {
      throw new Error(`candidate source changed during copy: ${entry.path}`);
    }
    await destinationHandle.sync();
  } finally {
    if (destinationHandle !== undefined) await destinationHandle.close();
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
    await mkdir(releaseDir, { mode: RELEASE_DIRECTORY_MODE });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("target release appeared after reviewed plan", { cause: error });
    throw error;
  }
  await ensureRealDirectory(releaseDir, "target release directory");
  await normalizeInstalledReleasePath(releaseDir, RELEASE_DIRECTORY_MODE, activationRoot);

  for (const rawEntry of manifest.files) {
    const entry = validateManifestEntry(rawEntry);
    const sourcePath = resolve(candidateRoot, ...entry.path.split("/"));
    const destinationPath = resolve(releaseDir, ...entry.path.split("/"));
    if (!isWithin(resolve(candidateRoot), sourcePath) || !isWithin(releaseDir, destinationPath)) {
      throw new Error("manifest path escaped reviewed roots");
    }
    await ensureReleaseParentDirectories(releaseDir, entry.path, activationRoot);
    const sourceHandle = await openVerifiedCandidateSource({ candidateRoot, entry });
    try {
      await copyVerifiedCandidateSourceHandle({ sourceHandle, destinationPath, entry });
    } finally {
      await sourceHandle.close();
    }
    await normalizeInstalledReleasePath(destinationPath, RELEASE_REGULAR_FILE_MODE, activationRoot);
    await verifyManifestFileAgainstEntry(destinationPath, entry);
  }

  await verifyProductionCandidateManifest({ rootDir: releaseDir, sourceSha: manifest.sourceSha, manifest });
  const markerPath = resolve(releaseDir, MANIFEST_MARKER);
  await writeFile(markerPath, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", flag: "wx", mode: MANIFEST_MARKER_MODE });
  await normalizeInstalledReleasePath(markerPath, MANIFEST_MARKER_MODE, activationRoot);
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

export async function applyReleaseActivation({
  activationRoot,
  candidateRoot,
  manifestPath,
  sourceSha,
  expectedCurrent,
  expectedCandidateSha256,
  contract,
}) {
  const production = isProductionActivationRoot(activationRoot);
  if (production) {
    await assertTrustedProductionControllerEntrypoint();
    await preparePrivilegedActivation({
      activationRoot,
      candidateRoot,
      manifestPath,
      sourceSha,
      expectedCandidateSha256,
      contract,
    });
  } else {
    await planReleaseActivation({ activationRoot, candidateRoot, manifestPath, sourceSha, contract });
  }

  return withExclusiveApplyLock(activationRoot, async () => {
    let observed;
    let manifest;
    let target;
    let candidateRootResolved;
    if (production) {
      const prepared = await preparePrivilegedActivation({
        activationRoot,
        candidateRoot,
        manifestPath,
        sourceSha,
        expectedCandidateSha256,
        contract,
      });
      observed = prepared.observedCurrent;
      manifest = prepared.manifest;
      target = prepared.target;
      candidateRootResolved = prepared.candidateRoot;
    } else {
      const plan = await planReleaseActivation({ activationRoot, candidateRoot, manifestPath, sourceSha, contract });
      observed = plan.observedCurrent === "none" ? null : plan.observedCurrent;
      manifest = await loadAndVerifyCandidate({ candidateRoot, manifestPath, sourceSha });
      target = await inspectTargetRelease(activationRoot, sourceSha);
      candidateRootResolved = resolve(candidateRoot);
    }

    assertExpectedCurrent(observed, expectedCurrent);
    if (!target.exists) {
      await copyVerifiedRelease({ activationRoot, candidateRoot: candidateRootResolved, manifest });
    }
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
  if (isProductionActivationRoot(activationRoot)) await assertTrustedProductionControllerEntrypoint();
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
    else if (key === "--expected-candidate") input.expectedCandidateSha256 = value;
    else if (key === "--ack") input.ack = value;
    else throw new Error("unknown CLI argument");
  }
  if (input.rollbackSha !== undefined && input.sourceSha !== undefined) throw new Error("activate and rollback modes are mutually exclusive");
  return input;
}

async function main() {
  try {
    const input = parseCli(process.argv.slice(2));
    const contractPath = resolve(MODULE_ROOT, "ops/production/release-activation-contract.json");
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
    if (input.expectedCandidateSha256 === undefined) throw new Error("activation apply requires --expected-candidate from the reviewed plan");
    const result = await applyReleaseActivation({
      activationRoot: PRODUCTION_ROOT,
      candidateRoot: input.candidateRoot,
      manifestPath: input.manifestPath,
      sourceSha: input.sourceSha,
      expectedCurrent: input.expectedCurrent,
      expectedCandidateSha256: input.expectedCandidateSha256,
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
