import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readlink, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  validateReleaseActivationContract,
  withExclusiveApplyLock,
} from "./production-release-controller.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const APPLY_LOCK_NAME = ".dashboard-release-controller.lock";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const controllerSource = await readFile(resolve(ROOT, "tools/production-release-controller.mjs"), "utf8");

async function makeWorkspace(t) {
  const root = await mkdtemp(resolve(tmpdir(), "dashboard-issue238-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

async function lockEvidence(root) {
  const path = resolve(root, APPLY_LOCK_NAME);
  const evidenceStat = await stat(path);
  return {
    path,
    mode: evidenceStat.mode & 0o777,
    content: await readFile(path, "utf8"),
  };
}

test("release contract declares fail-closed apply-lock evidence semantics", async () => {
  const contract = JSON.parse(
    await readFile(resolve(ROOT, "ops/production/release-activation-contract.json"), "utf8"),
  );
  assert.equal(validateReleaseActivationContract(contract), contract);
  assert.deepEqual(contract.failureEvidence, {
    preMutationFailureReleasesApplyLock: true,
    postMutationFailurePreservesApplyLock: true,
    successfulApplyReleasesApplyLock: true,
    manualCleanupRequired: true,
    storedMetadata: "none",
  });
  assert.throws(
    () =>
      validateReleaseActivationContract({
        ...contract,
        failureEvidence: {
          ...contract.failureEvidence,
          postMutationFailurePreservesApplyLock: false,
        },
      }),
    /failure evidence invariant/u,
  );
});

test("pre-mutation failure releases only the transient apply lock", async (t) => {
  const root = await makeWorkspace(t);
  await assert.rejects(
    withExclusiveApplyLock(root, async () => {
      throw new Error("preflight failed");
    }),
    /preflight failed/u,
  );
  await assert.rejects(stat(resolve(root, APPLY_LOCK_NAME)), { code: "ENOENT" });
});

test("failure after release-directory creation preserves review-required evidence", async (t) => {
  const root = await makeWorkspace(t);
  const releaseDir = resolve(root, "releases", SHA_A);

  await assert.rejects(
    withExclusiveApplyLock(root, async (mutationState) => {
      await mkdir(releaseDir, { recursive: true });
      mutationState.markStarted();
      throw new Error("failure after release directory creation");
    }),
    /failed after mutation started; apply lock preserved/u,
  );

  assert.equal((await stat(releaseDir)).isDirectory(), true);
  const evidence = await lockEvidence(root);
  assert.equal(evidence.mode, 0o600);
  assert.equal(evidence.content, "");

  let callbackRan = false;
  await assert.rejects(
    withExclusiveApplyLock(root, async () => {
      callbackRan = true;
    }),
    /apply lock already exists/u,
  );
  assert.equal(callbackRan, false);
});

test("failure after file installation preserves the lock and installed evidence", async (t) => {
  const root = await makeWorkspace(t);
  const releaseDir = resolve(root, "releases", SHA_A);
  const installed = resolve(releaseDir, "artifact.txt");

  await assert.rejects(
    withExclusiveApplyLock(root, async (mutationState) => {
      await mkdir(releaseDir, { recursive: true });
      mutationState.markStarted();
      await writeFile(installed, "installed-before-failure\n", "utf8");
      throw new Error("failure after file installation");
    }),
    /failed after mutation started; apply lock preserved/u,
  );

  assert.equal(await readFile(installed, "utf8"), "installed-before-failure\n");
  assert.equal((await lockEvidence(root)).content, "");
});

test("failure after current-pointer swap preserves lock and does not undo the pointer", async (t) => {
  const root = await makeWorkspace(t);
  await mkdir(resolve(root, "releases", SHA_A), { recursive: true });
  await mkdir(resolve(root, "releases", SHA_B), { recursive: true });
  const current = resolve(root, "current");
  await symlink(`releases/${SHA_A}`, current);

  await assert.rejects(
    withExclusiveApplyLock(root, async (mutationState) => {
      const temporary = resolve(root, ".current.next-test");
      await symlink(`releases/${SHA_B}`, temporary);
      mutationState.markStarted();
      await rename(temporary, current);
      throw new Error("failure after current pointer swap");
    }),
    /failed after mutation started; apply lock preserved/u,
  );

  assert.equal(await readlink(current), `releases/${SHA_B}`);
  assert.equal((await lockEvidence(root)).content, "");
});

test("successful mutation removes its transient apply lock only after completion", async (t) => {
  const root = await makeWorkspace(t);
  const releaseDir = resolve(root, "releases", SHA_A);

  const result = await withExclusiveApplyLock(root, async (mutationState) => {
    await mkdir(releaseDir, { recursive: true });
    mutationState.markStarted();
    return "verified-success";
  });

  assert.equal(result, "verified-success");
  await assert.rejects(stat(resolve(root, APPLY_LOCK_NAME)), { code: "ENOENT" });
});

test("controller wires mutation evidence into activation and rollback without cleanup bypass", () => {
  assert.match(
    controllerSource,
    /copyVerifiedRelease\(\{ activationRoot, candidateRoot, manifest, mutationState \}\)/u,
  );
  assert.match(controllerSource, /mutationState\.markStarted\(\);\n {2}const releaseDir/u);
  assert.match(controllerSource, /await symlink\(target, temporary\);\n {2}mutationState\.markStarted\(\);\n {2}await rename/u);
  assert.match(
    controllerSource,
    /swapCurrentPointer\(activationRoot, sourceSha, mutationState\)/u,
  );
  assert.match(
    controllerSource,
    /swapCurrentPointer\(activationRoot, rollbackSha, mutationState\)/u,
  );
  assert.doesNotMatch(controllerSource, /unlink\(temporary\)/u);
  assert.doesNotMatch(controllerSource, /--(?:cleanup|clear-lock|force|ignore-lock)/u);
});
