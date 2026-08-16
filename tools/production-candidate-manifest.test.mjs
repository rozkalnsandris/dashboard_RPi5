import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";

import {
  PRODUCTION_CANDIDATE_DIRECTORY_ROOTS,
  PRODUCTION_CANDIDATE_FILE_ROOTS,
  createProductionCandidateManifest,
  verifyProductionCandidateManifest,
} from "./production-candidate-manifest.mjs";

const SHA = "1234567890abcdef1234567890abcdef12345678";

async function writeFixtureFile(root, relativePath, content = relativePath) {
  const absolutePath = resolve(root, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

async function createFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "dashboard-rpi5-candidate-"));
  for (const directory of PRODUCTION_CANDIDATE_DIRECTORY_ROOTS) {
    await writeFixtureFile(root, `${directory}/index.js`, `console.log(${JSON.stringify(directory)});\n`);
    await writeFixtureFile(root, `${directory}/nested/data.txt`, `${directory}\n`);
  }
  for (const file of PRODUCTION_CANDIDATE_FILE_ROOTS) {
    await writeFixtureFile(root, file, `${file}\n`);
  }
  return root;
}

test("candidate manifest is deterministic and exact-SHA bound", async () => {
  const root = await createFixture();
  try {
    const first = await createProductionCandidateManifest({ rootDir: root, sourceSha: SHA });
    const second = await createProductionCandidateManifest({ rootDir: root, sourceSha: SHA });

    assert.deepEqual(second, first);
    assert.equal(first.sourceSha, SHA);
    assert.equal(first.releasePath, `/opt/dashboard_RPi5/releases/${SHA}`);
    assert.equal(first.hashAlgorithm, "sha256");
    assert.equal(first.files.length, first.fileCount);
    assert.ok(first.fileCount > PRODUCTION_CANDIDATE_FILE_ROOTS.length);
    assert.match(first.candidateSha256, /^[0-9a-f]{64}$/u);
    assert.deepEqual(
      first.files.map((file) => file.path),
      [...first.files.map((file) => file.path)].sort(),
    );
    assert.equal("generatedAt" in first, false);
    assert.equal("hostname" in first, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("candidate digest changes when build content changes", async () => {
  const root = await createFixture();
  try {
    const before = await createProductionCandidateManifest({ rootDir: root, sourceSha: SHA });
    await writeFixtureFile(root, "apps/server/dist/index.js", "changed\n");
    const after = await createProductionCandidateManifest({ rootDir: root, sourceSha: SHA });

    assert.notEqual(after.candidateSha256, before.candidateSha256);
    assert.notEqual(
      after.files.find((file) => file.path === "apps/server/dist/index.js")?.sha256,
      before.files.find((file) => file.path === "apps/server/dist/index.js")?.sha256,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verification fails closed after candidate content drift", async () => {
  const root = await createFixture();
  try {
    const manifest = await createProductionCandidateManifest({ rootDir: root, sourceSha: SHA });
    await verifyProductionCandidateManifest({ rootDir: root, sourceSha: SHA, manifest });

    await writeFixtureFile(root, "apps/agent/dist/index.js", "drift\n");
    await assert.rejects(
      verifyProductionCandidateManifest({ rootDir: root, sourceSha: SHA, manifest }),
      /does not match exact build contents/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("candidate traversal rejects symlinks", async () => {
  const root = await createFixture();
  try {
    await symlink(resolve(root, "package.json"), resolve(root, "apps/web/dist/package-link"));
    await assert.rejects(
      createProductionCandidateManifest({ rootDir: root, sourceSha: SHA }),
      /candidate symlink is forbidden/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("candidate manifest rejects malformed source SHA", async () => {
  const root = await createFixture();
  try {
    await assert.rejects(
      createProductionCandidateManifest({ rootDir: root, sourceSha: "main" }),
      /source SHA must be 40 lowercase hexadecimal characters/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
