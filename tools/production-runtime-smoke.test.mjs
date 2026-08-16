import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";

import {
  assertNoNodeModulesResolutionPath,
  materializeCandidate,
  safeRelativePath,
} from "./production-runtime-smoke.mjs";

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function writeFixture(root, relativePath, content) {
  const path = resolve(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

test("runtime smoke rejects traversal and node_modules manifest paths", () => {
  assert.equal(safeRelativePath("apps/agent/dist/index.js"), "apps/agent/dist/index.js");
  for (const value of [
    "../escape.js",
    "apps/../escape.js",
    "/absolute.js",
    "apps\\agent\\index.js",
    "node_modules/pkg/index.js",
    "apps/node_modules/pkg/index.js",
  ]) {
    assert.throws(() => safeRelativePath(value), /candidate manifest path is invalid|node_modules/u);
  }
});

test("runtime smoke materializes only digest-matching regular files", async () => {
  const tempRoot = await mkdtemp(resolve(tmpdir(), "dashboard-rpi5-runtime-smoke-test-"));
  const sourceRoot = resolve(tempRoot, "source");
  const candidateRoot = resolve(tempRoot, "candidate");
  const content = "runtime-closed\n";
  try {
    await writeFixture(sourceRoot, "apps/agent/dist/index.js", content);
    await mkdir(candidateRoot, { recursive: true });
    await materializeCandidate({
      rootDir: sourceRoot,
      candidateRoot,
      manifest: {
        fileCount: 1,
        files: [
          {
            path: "apps/agent/dist/index.js",
            bytes: Buffer.byteLength(content),
            sha256: sha256(content),
          },
        ],
      },
    });
    assert.equal(await readFile(resolve(candidateRoot, "apps/agent/dist/index.js"), "utf8"), content);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime smoke rejects node_modules anywhere on the isolated resolution path", async () => {
  const tempRoot = await mkdtemp(resolve(tmpdir(), "dashboard-rpi5-runtime-smoke-test-"));
  const candidateRoot = resolve(tempRoot, "candidate");
  try {
    await mkdir(candidateRoot, { recursive: true });
    await assert.doesNotReject(assertNoNodeModulesResolutionPath(candidateRoot));
    await mkdir(resolve(tempRoot, "node_modules"));
    await assert.rejects(
      assertNoNodeModulesResolutionPath(candidateRoot),
      /node_modules exists on candidate resolution path/u,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
