import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdtemp, mkdir, readFile, readlink, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PRODUCTION_CANDIDATE_DIRECTORY_ROOTS,
  PRODUCTION_CANDIDATE_FILE_ROOTS,
  createProductionCandidateManifest,
  verifyInstalledProductionCandidateManifest,
  verifyProductionCandidateManifest,
} from "./production-candidate-manifest.mjs";
import {
  applyReleaseActivation,
  applyReleaseRollback,
  planReleaseActivation,
  planReleaseRollback,
  validateReleaseActivationContract,
} from "./production-release-controller.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY_LOCK_NAME = ".dashboard-release-controller.lock";
const MANIFEST_MARKER = ".dashboard-production-candidate.json";
const HISTORICAL_OMITTED_PATH = "tools/production-runtime-smoke.mjs";

async function loadContract() {
  return JSON.parse(await readFile(resolve(ROOT, "ops/production/release-activation-contract.json"), "utf8"));
}

async function makeWorkspace(t) {
  const root = await mkdtemp(resolve(tmpdir(), "dashboard-release-controller-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

async function makeCandidate(t, sha, variant) {
  const workspace = await makeWorkspace(t);
  const candidateRoot = resolve(workspace, "candidate");
  await mkdir(candidateRoot, { recursive: true });
  for (const directory of PRODUCTION_CANDIDATE_DIRECTORY_ROOTS) {
    const artifact = resolve(candidateRoot, directory, "artifact.txt");
    await mkdir(dirname(artifact), { recursive: true });
    await writeFile(artifact, `${variant}:${directory}\n`, "utf8");
  }
  for (const file of PRODUCTION_CANDIDATE_FILE_ROOTS) {
    const path = resolve(candidateRoot, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${variant}:${file}\n`, "utf8");
  }
  const manifest = await createProductionCandidateManifest({ rootDir: candidateRoot, sourceSha: sha });
  const manifestPath = resolve(workspace, "candidate-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
  return { workspace, candidateRoot, manifestPath, manifest };
}

function historicalManifestFrom(candidateManifest, omittedPath = HISTORICAL_OMITTED_PATH) {
  const files = candidateManifest.files.filter((entry) => entry.path !== omittedPath);
  assert.equal(files.length, candidateManifest.files.length - 1);
  const core = {
    schema: candidateManifest.schema,
    sourceSha: candidateManifest.sourceSha,
    releasePath: candidateManifest.releasePath,
    nodeMajor: candidateManifest.nodeMajor,
    hashAlgorithm: candidateManifest.hashAlgorithm,
    fileCount: files.length,
    totalBytes: files.reduce((total, entry) => total + entry.bytes, 0),
    files,
  };
  return {
    ...core,
    candidateSha256: createHash("sha256").update(JSON.stringify(core), "utf8").digest("hex"),
  };
}

async function installHistoricalRelease({ activationRoot, candidate, makeCurrent = true }) {
  const releaseDir = resolve(activationRoot, "releases", candidate.manifest.sourceSha);
  await mkdir(releaseDir, { recursive: true });
  const manifest = historicalManifestFrom(candidate.manifest);
  for (const entry of manifest.files) {
    const source = resolve(candidate.candidateRoot, entry.path);
    const destination = resolve(releaseDir, entry.path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  await writeFile(resolve(releaseDir, MANIFEST_MARKER), `${JSON.stringify(manifest)}\n`, "utf8");
  if (makeCurrent) await symlink(`releases/${candidate.manifest.sourceSha}`, resolve(activationRoot, "current"));
  return { releaseDir, manifest };
}

async function pathExists(path) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error?.code === "EISDIR") return true;
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function manifestDirectoryPaths(root, manifest) {
  const directories = new Set([root]);
  for (const entry of manifest.files) {
    let current = root;
    for (const segment of entry.path.split("/").slice(0, -1)) {
      current = resolve(current, segment);
      directories.add(current);
    }
  }
  return [...directories];
}

async function modeOf(path) {
  return (await stat(path)).mode & 0o777;
}

test("release activation contract locks production and owner gates", async () => {
  const contract = await loadContract();
  assert.equal(validateReleaseActivationContract(contract), contract);
  assert.deepEqual(contract.releaseMetadata, {
    owner: "root",
    group: "root",
    directoryMode: "0755",
    regularFileMode: "0644",
    manifestMarkerMode: "0600",
    callerUmaskIndependent: true,
  });
  assert.throws(() => validateReleaseActivationContract({ ...contract, productionRoot: "/tmp/dashboard" }), /production path mismatch/u);
  assert.throws(
    () => validateReleaseActivationContract({ ...contract, releaseMetadata: { ...contract.releaseMetadata, directoryMode: "0700" } }),
    /metadata invariant/u,
  );
  assert.throws(() => validateReleaseActivationContract({ ...contract, exclusiveApplyLock: false }), /atomic\/retention/u);
  assert.throws(() => validateReleaseActivationContract({ ...contract, staleLockAutoCleanup: true }), /atomic\/retention/u);
  assert.throws(() => validateReleaseActivationContract({ ...contract, deleteReleaseDuringActivation: true }), /atomic\/retention/u);
  assert.throws(() => validateReleaseActivationContract({ ...contract, networkAllowed: true }), /forbidden capability/u);
});

test("plan validates exact candidate without writing activation root", async (t) => {
  const contract = await loadContract();
  const candidate = await makeCandidate(t, SHA_A, "a");
  const activationRoot = resolve(candidate.workspace, "activation");
  const plan = await planReleaseActivation({ activationRoot, candidateRoot: candidate.candidateRoot, manifestPath: candidate.manifestPath, sourceSha: SHA_A, contract });
  assert.equal(plan.status, "PLAN");
  assert.equal(plan.observedCurrent, "none");
  assert.equal(plan.targetRelease, "absent");
  assert.deepEqual(plan.operations, ["copy_manifest_allowlisted_release", "write_verified_manifest_marker", "atomic_current_symlink_swap"]);
  assert.equal(await pathExists(activationRoot), false);
});

test("plan remains non-mutating under restrictive caller umask", async (t) => {
  const contract = await loadContract();
  const candidate = await makeCandidate(t, SHA_A, "plan-umask");
  const activationRoot = resolve(candidate.workspace, "activation-plan-umask");
  const previousUmask = process.umask(0o077);
  let plan;
  try {
    plan = await planReleaseActivation({
      activationRoot,
      candidateRoot: candidate.candidateRoot,
      manifestPath: candidate.manifestPath,
      sourceSha: SHA_A,
      contract,
    });
  } finally {
    process.umask(previousUmask);
  }
  assert.equal(plan.status, "PLAN");
  assert.equal(plan.targetRelease, "absent");
  assert.equal(await pathExists(activationRoot), false);
});

test("apply copies only manifest files, verifies marker and activates relative current pointer", async (t) => {
  const contract = await loadContract();
  const candidate = await makeCandidate(t, SHA_A, "a");
  const activationRoot = resolve(candidate.workspace, "activation");
  const result = await applyReleaseActivation({ activationRoot, candidateRoot: candidate.candidateRoot, manifestPath: candidate.manifestPath, sourceSha: SHA_A, expectedCurrent: "none", contract });
  assert.equal(result.status, "APPLIED");
  assert.equal(result.previousRelease, "none");
  assert.equal(result.currentRelease, SHA_A);
  assert.equal(result.releasesDeleted, 0);
  assert.equal(await readlink(resolve(activationRoot, "current")), `releases/${SHA_A}`);
  assert.equal(await pathExists(resolve(activationRoot, APPLY_LOCK_NAME)), false);
  const marker = JSON.parse(await readFile(resolve(activationRoot, "releases", SHA_A, MANIFEST_MARKER), "utf8"));
  assert.equal(marker.candidateSha256, candidate.manifest.candidateSha256);
});

test("apply normalizes exact target metadata under umask 077 without changing content or parent paths", async (t) => {
  const contract = await loadContract();
  const candidate = await makeCandidate(t, SHA_A, "restrictive-metadata");

  for (const path of manifestDirectoryPaths(candidate.candidateRoot, candidate.manifest)) await chmod(path, 0o700);
  for (const entry of candidate.manifest.files) await chmod(resolve(candidate.candidateRoot, entry.path), 0o600);
  assert.equal(await modeOf(candidate.candidateRoot), 0o700);
  assert.equal(await modeOf(resolve(candidate.candidateRoot, candidate.manifest.files[0].path)), 0o600);

  const activationRoot = resolve(candidate.workspace, "activation-umask");
  const releasesRoot = resolve(activationRoot, "releases");
  await mkdir(releasesRoot, { recursive: true, mode: 0o755 });
  await chmod(activationRoot, 0o755);
  await chmod(releasesRoot, 0o755);
  const outsideSentinel = resolve(activationRoot, "outside-target.txt");
  await writeFile(outsideSentinel, "outside-target-must-not-change\n", "utf8");
  await chmod(outsideSentinel, 0o600);
  const outsideBefore = await readFile(outsideSentinel, "utf8");

  const previousUmask = process.umask(0o077);
  let result;
  try {
    result = await applyReleaseActivation({
      activationRoot,
      candidateRoot: candidate.candidateRoot,
      manifestPath: candidate.manifestPath,
      sourceSha: SHA_A,
      expectedCurrent: "none",
      contract,
    });
  } finally {
    process.umask(previousUmask);
  }

  assert.equal(result.status, "APPLIED");
  const releaseDir = resolve(releasesRoot, SHA_A);
  for (const path of manifestDirectoryPaths(releaseDir, candidate.manifest)) assert.equal(await modeOf(path), 0o755, path);
  for (const entry of candidate.manifest.files) assert.equal(await modeOf(resolve(releaseDir, entry.path)), 0o644, entry.path);
  const markerPath = resolve(releaseDir, MANIFEST_MARKER);
  assert.equal(await modeOf(markerPath), 0o600);

  const installedManifest = JSON.parse(await readFile(markerPath, "utf8"));
  assert.equal(installedManifest.candidateSha256, candidate.manifest.candidateSha256);
  await verifyInstalledProductionCandidateManifest({ rootDir: releaseDir, sourceSha: SHA_A, manifest: installedManifest });

  assert.equal(await modeOf(activationRoot), 0o755);
  assert.equal(await modeOf(releasesRoot), 0o755);
  assert.equal(await modeOf(outsideSentinel), 0o600);
  assert.equal(await readFile(outsideSentinel, "utf8"), outsideBefore);
});

test("pre-existing apply lock blocks and is never auto-cleared", async (t) => {
  const contract = await loadContract();
  const candidate = await makeCandidate(t, SHA_A, "a");
  const activationRoot = resolve(candidate.workspace, "activation");
  await mkdir(activationRoot, { recursive: true });
  const lockPath = resolve(activationRoot, APPLY_LOCK_NAME);
  await writeFile(lockPath, "review-required\n", "utf8");
  await assert.rejects(
    applyReleaseActivation({ activationRoot, candidateRoot: candidate.candidateRoot, manifestPath: candidate.manifestPath, sourceSha: SHA_A, expectedCurrent: "none", contract }),
    /apply lock already exists/u,
  );
  assert.equal(await readFile(lockPath, "utf8"), "review-required\n");
  assert.equal(await pathExists(resolve(activationRoot, "releases", SHA_A)), false);
});

test("activation and releases roots reject symlinks instead of following them", async (t) => {
  const contract = await loadContract();
  const candidate = await makeCandidate(t, SHA_A, "a");
  const outside = resolve(candidate.workspace, "outside");
  await mkdir(outside, { recursive: true });

  const activationLink = resolve(candidate.workspace, "activation-link");
  await symlink(outside, activationLink);
  await assert.rejects(
    planReleaseActivation({ activationRoot: activationLink, candidateRoot: candidate.candidateRoot, manifestPath: candidate.manifestPath, sourceSha: SHA_A, contract }),
    /activation root must be a real directory/u,
  );

  const activationRoot = resolve(candidate.workspace, "activation-real");
  await mkdir(activationRoot, { recursive: true });
  await symlink(outside, resolve(activationRoot, "releases"));
  await assert.rejects(
    planReleaseActivation({ activationRoot, candidateRoot: candidate.candidateRoot, manifestPath: candidate.manifestPath, sourceSha: SHA_A, contract }),
    /releases root must be a real directory/u,
  );
});

test("historical installed release remains valid after current allowlist grows", async (t) => {
  const contract = await loadContract();
  const historicalCandidate = await makeCandidate(t, SHA_A, "historical");
  const nextCandidate = await makeCandidate(t, SHA_B, "next");
  const activationRoot = resolve(historicalCandidate.workspace, "activation");
  const historical = await installHistoricalRelease({ activationRoot, candidate: historicalCandidate });

  await verifyInstalledProductionCandidateManifest({
    rootDir: historical.releaseDir,
    sourceSha: SHA_A,
    manifest: historical.manifest,
  });
  await assert.rejects(
    verifyProductionCandidateManifest({ rootDir: historical.releaseDir, sourceSha: SHA_A, manifest: historical.manifest }),
    /production-runtime-smoke|ENOENT|exact build contents/u,
  );

  const plan = await planReleaseActivation({
    activationRoot,
    candidateRoot: nextCandidate.candidateRoot,
    manifestPath: nextCandidate.manifestPath,
    sourceSha: SHA_B,
    contract,
  });
  assert.equal(plan.observedCurrent, SHA_A);
  assert.equal(plan.targetRelease, "absent");
  assert.deepEqual(plan.operations, ["copy_manifest_allowlisted_release", "write_verified_manifest_marker", "atomic_current_symlink_swap"]);
});

test("historical installed manifest rejects digest, tree, traversal and symlink drift", async (t) => {
  const candidate = await makeCandidate(t, SHA_A, "historical-integrity");

  const digestRoot = resolve(candidate.workspace, "activation-digest");
  const digestFixture = await installHistoricalRelease({ activationRoot: digestRoot, candidate });
  await assert.rejects(
    verifyInstalledProductionCandidateManifest({
      rootDir: digestFixture.releaseDir,
      sourceSha: SHA_A,
      manifest: { ...digestFixture.manifest, candidateSha256: "0".repeat(64) },
    }),
    /manifest digest mismatch/u,
  );

  const missingRoot = resolve(candidate.workspace, "activation-missing");
  const missingFixture = await installHistoricalRelease({ activationRoot: missingRoot, candidate });
  await unlink(resolve(missingFixture.releaseDir, missingFixture.manifest.files[0].path));
  await assert.rejects(
    verifyInstalledProductionCandidateManifest({ rootDir: missingFixture.releaseDir, sourceSha: SHA_A, manifest: missingFixture.manifest }),
    /release tree does not match/u,
  );

  const extraRoot = resolve(candidate.workspace, "activation-extra");
  const extraFixture = await installHistoricalRelease({ activationRoot: extraRoot, candidate });
  await writeFile(resolve(extraFixture.releaseDir, "unexpected.txt"), "drift\n", "utf8");
  await assert.rejects(
    verifyInstalledProductionCandidateManifest({ rootDir: extraFixture.releaseDir, sourceSha: SHA_A, manifest: extraFixture.manifest }),
    /release tree does not match/u,
  );

  const traversalRoot = resolve(candidate.workspace, "activation-traversal");
  const traversalFixture = await installHistoricalRelease({ activationRoot: traversalRoot, candidate });
  const traversalManifest = JSON.parse(JSON.stringify(traversalFixture.manifest));
  traversalManifest.files[0].path = "../escape";
  await assert.rejects(
    verifyInstalledProductionCandidateManifest({ rootDir: traversalFixture.releaseDir, sourceSha: SHA_A, manifest: traversalManifest }),
    /path escapes release root/u,
  );

  const symlinkRoot = resolve(candidate.workspace, "activation-symlink");
  const symlinkFixture = await installHistoricalRelease({ activationRoot: symlinkRoot, candidate });
  const firstPath = resolve(symlinkFixture.releaseDir, symlinkFixture.manifest.files[0].path);
  const replacement = resolve(candidate.workspace, "historical-replacement.txt");
  await writeFile(replacement, await readFile(firstPath));
  await unlink(firstPath);
  await symlink(replacement, firstPath);
  await assert.rejects(
    verifyInstalledProductionCandidateManifest({ rootDir: symlinkFixture.releaseDir, sourceSha: SHA_A, manifest: symlinkFixture.manifest }),
    /installed release symlink is forbidden/u,
  );
});

test("historical installed release remains a verified rollback target", async (t) => {
  const contract = await loadContract();
  const historicalCandidate = await makeCandidate(t, SHA_A, "historical-rollback");
  const nextCandidate = await makeCandidate(t, SHA_B, "next-rollback");
  const activationRoot = resolve(historicalCandidate.workspace, "activation");
  await installHistoricalRelease({ activationRoot, candidate: historicalCandidate });

  const applied = await applyReleaseActivation({
    activationRoot,
    candidateRoot: nextCandidate.candidateRoot,
    manifestPath: nextCandidate.manifestPath,
    sourceSha: SHA_B,
    expectedCurrent: SHA_A,
    contract,
  });
  assert.equal(applied.currentRelease, SHA_B);

  const rollbackPlan = await planReleaseRollback({ activationRoot, rollbackSha: SHA_A, contract });
  assert.equal(rollbackPlan.observedCurrent, SHA_B);
  assert.equal(rollbackPlan.rollbackSha, SHA_A);
  assert.deepEqual(rollbackPlan.operations, ["atomic_current_symlink_swap"]);
});

test("stale expected-current blocks before a second release is written", async (t) => {
  const contract = await loadContract();
  const first = await makeCandidate(t, SHA_A, "a");
  const second = await makeCandidate(t, SHA_B, "b");
  const activationRoot = resolve(first.workspace, "activation");
  await applyReleaseActivation({ activationRoot, candidateRoot: first.candidateRoot, manifestPath: first.manifestPath, sourceSha: SHA_A, expectedCurrent: "none", contract });
  await assert.rejects(
    applyReleaseActivation({ activationRoot, candidateRoot: second.candidateRoot, manifestPath: second.manifestPath, sourceSha: SHA_B, expectedCurrent: "none", contract }),
    /current release changed/u,
  );
  assert.equal(await pathExists(resolve(activationRoot, "releases", SHA_B)), false);
});

test("rollback requires a verified existing release and retains both releases", async (t) => {
  const contract = await loadContract();
  const first = await makeCandidate(t, SHA_A, "a");
  const second = await makeCandidate(t, SHA_B, "b");
  const activationRoot = resolve(first.workspace, "activation");
  await applyReleaseActivation({ activationRoot, candidateRoot: first.candidateRoot, manifestPath: first.manifestPath, sourceSha: SHA_A, expectedCurrent: "none", contract });
  await applyReleaseActivation({ activationRoot, candidateRoot: second.candidateRoot, manifestPath: second.manifestPath, sourceSha: SHA_B, expectedCurrent: SHA_A, contract });
  const plan = await planReleaseRollback({ activationRoot, rollbackSha: SHA_A, contract });
  assert.equal(plan.observedCurrent, SHA_B);
  assert.deepEqual(plan.operations, ["atomic_current_symlink_swap"]);
  const result = await applyReleaseRollback({ activationRoot, rollbackSha: SHA_A, expectedCurrent: SHA_B, contract });
  assert.equal(result.status, "ROLLED_BACK");
  assert.equal(result.currentRelease, SHA_A);
  assert.equal(result.releasesDeleted, 0);
  assert.equal(await readlink(resolve(activationRoot, "current")), `releases/${SHA_A}`);
  assert.equal(await pathExists(resolve(activationRoot, "releases", SHA_A, "package.json")), true);
  assert.equal(await pathExists(resolve(activationRoot, "releases", SHA_B, "package.json")), true);
});

test("rollback rejects an unverified target release", async (t) => {
  const contract = await loadContract();
  const first = await makeCandidate(t, SHA_A, "a");
  const activationRoot = resolve(first.workspace, "activation");
  await applyReleaseActivation({ activationRoot, candidateRoot: first.candidateRoot, manifestPath: first.manifestPath, sourceSha: SHA_A, expectedCurrent: "none", contract });
  const fake = resolve(activationRoot, "releases", SHA_B);
  await mkdir(fake, { recursive: true });
  await writeFile(resolve(fake, MANIFEST_MARKER), "{}\n", "utf8");
  await assert.rejects(planReleaseRollback({ activationRoot, rollbackSha: SHA_B, contract }), /candidate manifest schema mismatch/u);
});

test("candidate symlink and tampered manifest escape are fail-closed", async (t) => {
  const contract = await loadContract();
  const candidate = await makeCandidate(t, SHA_A, "a");
  const activationRoot = resolve(candidate.workspace, "activation");
  const file = resolve(candidate.candidateRoot, PRODUCTION_CANDIDATE_FILE_ROOTS[0]);
  const replacement = resolve(candidate.workspace, "replacement.txt");
  await writeFile(replacement, await readFile(file));
  await unlink(file);
  await symlink(replacement, file);
  await assert.rejects(
    planReleaseActivation({ activationRoot, candidateRoot: candidate.candidateRoot, manifestPath: candidate.manifestPath, sourceSha: SHA_A, contract }),
    /candidate symlink is forbidden/u,
  );

  const clean = await makeCandidate(t, SHA_A, "clean");
  const tampered = JSON.parse(JSON.stringify(clean.manifest));
  tampered.files[0].path = "../escape";
  const tamperedPath = resolve(clean.workspace, "tampered.json");
  await writeFile(tamperedPath, `${JSON.stringify(tampered)}\n`, "utf8");
  await assert.rejects(
    planReleaseActivation({ activationRoot: resolve(clean.workspace, "activation"), candidateRoot: clean.candidateRoot, manifestPath: tamperedPath, sourceSha: SHA_A, contract }),
    /exact build contents|escaped|path/u,
  );
});

test("wrong exact SHA is rejected", async (t) => {
  const contract = await loadContract();
  const candidate = await makeCandidate(t, SHA_A, "a");
  await assert.rejects(
    planReleaseActivation({ activationRoot: resolve(candidate.workspace, "activation"), candidateRoot: candidate.candidateRoot, manifestPath: candidate.manifestPath, sourceSha: SHA_B, contract }),
    /source SHA mismatch/u,
  );
});

test("production metadata normalization is fixed, production-root-only and not caller configurable", async () => {
  const source = await readFile(resolve(ROOT, "tools/production-release-controller.mjs"), "utf8");
  assert.match(source, /const RELEASE_DIRECTORY_MODE = 0o755;/u);
  assert.match(source, /const RELEASE_REGULAR_FILE_MODE = 0o644;/u);
  assert.match(source, /const MANIFEST_MARKER_MODE = 0o600;/u);
  assert.match(source, /resolve\(activationRoot\) === PRODUCTION_ROOT/u);
  assert.match(source, /await chown\(path, ROOT_UID, ROOT_GID\);/u);
  assert.doesNotMatch(source, /--(?:owner|group|mode|chmod|chown)\b/u);
});

test("controller source has no shell, network, systemd, identity or recursive-delete primitive", async () => {
  const source = await readFile(resolve(ROOT, "tools/production-release-controller.mjs"), "utf8");
  assert.doesNotMatch(source, /node:child_process|["']child_process["']|\bfetch\s*\(|systemctl|useradd|groupadd|usermod|\bsudo\b|docker\.sock|cloudflare\.com\/client\/v4/iu);
  assert.doesNotMatch(source, /\brm\s*\(|\brmdir\s*\(/u);
  assert.doesNotMatch(source, /["']--root["']/u);
});
