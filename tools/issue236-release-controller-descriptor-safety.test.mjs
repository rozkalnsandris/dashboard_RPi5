import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";

import {
  copyVerifiedCandidateSourceHandle,
  openVerifiedCandidateSource,
} from "./production-release-controller.mjs";

function makeEntry(path, bytes) {
  return {
    path,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function makeWorkspace(t) {
  const workspace = await mkdtemp(resolve(tmpdir(), "dashboard-issue236-"));
  t.after(async () => rm(workspace, { recursive: true, force: true }));
  return workspace;
}

async function closeHandle(handle) {
  if (handle === undefined) return;
  await handle.close();
}

test("descriptor-safe copy stays pinned to the opened inode after pathname replacement", async (t) => {
  const workspace = await makeWorkspace(t);
  const candidateRoot = resolve(workspace, "candidate");
  const sourcePath = resolve(candidateRoot, "nested", "artifact.txt");
  const originalBytes = Buffer.from("reviewed-original-bytes\n", "utf8");
  const replacementBytes = Buffer.from("attacker-replacement-data\n", "utf8");
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, originalBytes);
  const entry = makeEntry("nested/artifact.txt", originalBytes);

  const sourceHandle = await openVerifiedCandidateSource({ candidateRoot, entry });
  try {
    await rename(sourcePath, resolve(candidateRoot, "nested", "opened-original.txt"));
    await writeFile(sourcePath, replacementBytes);
    const destinationRoot = resolve(workspace, "release");
    await mkdir(destinationRoot, { recursive: true });
    const destinationPath = resolve(destinationRoot, "artifact.txt");
    await copyVerifiedCandidateSourceHandle({ sourceHandle, destinationPath, entry });
    assert.deepEqual(await readFile(destinationPath), originalBytes);
  } finally {
    await closeHandle(sourceHandle);
  }
});

test("final candidate symlink is rejected before privileged consumption", async (t) => {
  const workspace = await makeWorkspace(t);
  const candidateRoot = resolve(workspace, "candidate");
  const outsidePath = resolve(workspace, "outside.txt");
  const sourcePath = resolve(candidateRoot, "artifact.txt");
  const bytes = Buffer.from("reviewed\n", "utf8");
  await mkdir(candidateRoot, { recursive: true });
  await writeFile(outsidePath, bytes);
  await symlink(outsidePath, sourcePath);
  const entry = makeEntry("artifact.txt", bytes);

  await assert.rejects(
    openVerifiedCandidateSource({ candidateRoot, entry }),
    /real non-symlink regular file/u,
  );
});

test("candidate parent-directory symlink is rejected instead of traversed", async (t) => {
  const workspace = await makeWorkspace(t);
  const candidateRoot = resolve(workspace, "candidate");
  const outsideRoot = resolve(workspace, "outside");
  const bytes = Buffer.from("reviewed\n", "utf8");
  await mkdir(candidateRoot, { recursive: true });
  await mkdir(outsideRoot, { recursive: true });
  await writeFile(resolve(outsideRoot, "artifact.txt"), bytes);
  await symlink(outsideRoot, resolve(candidateRoot, "nested"));
  const entry = makeEntry("nested/artifact.txt", bytes);

  await assert.rejects(
    openVerifiedCandidateSource({ candidateRoot, entry }),
    /real non-symlink directory/u,
  );
});

test("same-inode content tamper fails digest verification and leaves destination private", async (t) => {
  const workspace = await makeWorkspace(t);
  const candidateRoot = resolve(workspace, "candidate");
  const sourcePath = resolve(candidateRoot, "artifact.txt");
  const reviewedBytes = Buffer.from("reviewed-content\n", "utf8");
  const tamperedBytes = Buffer.from("tampered-content\n", "utf8");
  assert.equal(reviewedBytes.length, tamperedBytes.length);
  await mkdir(candidateRoot, { recursive: true });
  await writeFile(sourcePath, reviewedBytes);
  const entry = makeEntry("artifact.txt", reviewedBytes);
  const sourceHandle = await openVerifiedCandidateSource({ candidateRoot, entry });
  const destinationRoot = resolve(workspace, "release");
  const destinationPath = resolve(destinationRoot, "artifact.txt");
  await mkdir(destinationRoot, { recursive: true });

  try {
    await writeFile(sourcePath, tamperedBytes);
    await assert.rejects(
      copyVerifiedCandidateSourceHandle({ sourceHandle, destinationPath, entry }),
      /candidate source digest mismatch/u,
    );
  } finally {
    await closeHandle(sourceHandle);
  }

  assert.deepEqual(await readFile(destinationPath), tamperedBytes);
  assert.equal((await stat(destinationPath)).mode & 0o777, 0o600);
});

test("non-regular candidate source is rejected", async (t) => {
  const workspace = await makeWorkspace(t);
  const candidateRoot = resolve(workspace, "candidate");
  await mkdir(resolve(candidateRoot, "artifact.txt"), { recursive: true });
  const entry = makeEntry("artifact.txt", Buffer.alloc(0));
  await assert.rejects(openVerifiedCandidateSource({ candidateRoot, entry }), /regular file/u);
});

test("issue236 source locks privileged execution and removes pathname copy semantics", async () => {
  const controller = await readFile(resolve("tools/production-release-controller.mjs"), "utf8");
  const productionReadme = await readFile(resolve("ops/production/README.md"), "utf8");
  const activationDoc = await readFile(resolve("docs/PHASE11D_RELEASE_ACTIVATION.md"), "utf8");

  assert.match(controller, /O_NOFOLLOW/u);
  assert.match(controller, /\/proc\/self\/fd/u);
  assert.match(controller, /sourceHandle\.read/u);
  assert.match(controller, /PREVERIFICATION_DESTINATION_MODE = 0o600/u);
  assert.match(controller, /assertTrustedProductionControllerEntrypoint/u);
  assert.match(controller, /production apply controller must come from the current release/u);
  assert.match(controller, /requiresExpectedCandidateSha256/u);
  assert.match(controller, /resolve\(MODULE_ROOT, "ops\/production\/release-activation-contract\.json"\)/u);
  assert.doesNotMatch(controller, /copyFile\(sourcePath,\s*destinationPath/u);
  assert.doesNotMatch(controller, /node:child_process|\bfetch\s*\(|systemctl|useradd|groupadd|usermod|docker\.sock|cloudflare\.com\/client\/v4/iu);

  for (const docs of [productionReadme, activationDoc]) {
    assert.match(docs, /candidate checkout/iu);
    assert.match(docs, /root-owned/iu);
    assert.match(docs, /--expected-candidate/iu);
  }
  assert.doesNotMatch(productionReadme, /sudo\s+\/usr\/bin\/node\s+\.\/tools\/production-release-controller\.mjs/iu);
});

test("descriptor-safe copy does not depend on source permissions or mutate the source", async (t) => {
  const workspace = await makeWorkspace(t);
  const candidateRoot = resolve(workspace, "candidate");
  const sourcePath = resolve(candidateRoot, "artifact.txt");
  const bytes = Buffer.from("read-only-source\n", "utf8");
  await mkdir(candidateRoot, { recursive: true });
  await writeFile(sourcePath, bytes);
  await chmod(sourcePath, 0o444);
  const entry = makeEntry("artifact.txt", bytes);
  const before = await stat(sourcePath);
  const sourceHandle = await openVerifiedCandidateSource({ candidateRoot, entry });
  const destinationPath = resolve(workspace, "release", "artifact.txt");
  await mkdir(dirname(destinationPath), { recursive: true });
  try {
    await copyVerifiedCandidateSourceHandle({ sourceHandle, destinationPath, entry });
  } finally {
    await closeHandle(sourceHandle);
  }
  const after = await stat(sourcePath);
  assert.equal(after.mode & 0o777, before.mode & 0o777);
  assert.deepEqual(await readFile(sourcePath), bytes);
  assert.deepEqual(await readFile(destinationPath), bytes);
});
