import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readlink, rm, symlink, unlink, writeFile } from "node:fs/promises";
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
  applyReleaseRollback,
  planReleaseActivation,
  planReleaseRollback,
  validateReleaseActivationContract,
} from "./production-release-controller.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

test("release activation contract locks production and owner gates", async () => {
  const contract = await loadContract();
  assert.equal(validateReleaseActivationContract(contract), contract);
  assert.throws(() => validateReleaseActivationContract({ ...contract, productionRoot: "/tmp/dashboard" }), /production path mismatch/u);
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
  const marker = JSON.parse(await readFile(resolve(activationRoot, "releases", SHA_A, ".dashboard-production-candidate.json"), "utf8"));
  assert.equal(marker.candidateSha256, candidate.manifest.candidateSha256);
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
  await writeFile(resolve(fake, ".dashboard-production-candidate.json"), "{}\n", "utf8");
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

test("controller source has no shell, network, systemd, identity or recursive-delete primitive", async () => {
  const source = await readFile(resolve(ROOT, "tools/production-release-controller.mjs"), "utf8");
  assert.doesNotMatch(source, /node:child_process|\bfetch\s*\(|\bexec(?:File)?\s*\(|\bspawn\s*\(|systemctl|useradd|groupadd|usermod|\bsudo\b|docker\.sock|cloudflare\.com\/client\/v4/iu);
  assert.doesNotMatch(source, /\brm\s*\(|\brmdir\s*\(/u);
  assert.doesNotMatch(source, /["']--root["']/u);
});
