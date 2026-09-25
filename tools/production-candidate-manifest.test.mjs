import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { URL } from "node:url";
import test from "node:test";

import {
  PRODUCTION_CANDIDATE_CONTROLLER_BOOTSTRAP_V1_FILE_ROOTS,
  PRODUCTION_CANDIDATE_DIRECTORY_ROOTS,
  PRODUCTION_CANDIDATE_FILE_ROOTS,
  PRODUCTION_CANDIDATE_PROFILE_CONTROLLER_BOOTSTRAP_V1,
  productionCandidateFileRoots,
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
  await writeFixtureFile(
    root,
    "apps/agent/dist/log-broker-entry.js",
    "console.log('log-broker');\n",
  );
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
    assert.ok(first.files.some((file) => file.path === "apps/agent/dist/log-broker-entry.js"));
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

test("candidate manifest fails closed when the production log broker entrypoint is missing", async () => {
  const root = await createFixture();
  try {
    await unlink(resolve(root, "apps/agent/dist/log-broker-entry.js"));
    await assert.rejects(
      createProductionCandidateManifest({ rootDir: root, sourceSha: SHA }),
      /log broker production entrypoint must be a non-empty regular file/u,
    );
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


test("controller bootstrap v1 profile matches the historical trusted-controller closure", () => {
  const expected = [
    "package.json",
    "package-lock.json",
    "apps/web/package.json",
    "apps/server/package.json",
    "apps/agent/package.json",
    "apps/agent/dist/log-broker-entry.js",
    "apps/terminal-agent/package.json",
    "packages/contracts/package.json",
    "ops/production/launch-contract.json",
    "ops/production/web.env.example",
    "ops/production/terminal.env.example",
    "ops/production/smoke-contract.json",
    "ops/production/cloudflare-contract.json",
    "ops/production/cloudflare.env.example",
    "ops/production/release-activation-contract.json",
    "ops/production/host-readiness-contract.json",
    "ops/systemd/dashboard-rpi5-web.service",
    "ops/systemd/dashboard-rpi5-agent.service",
    "ops/systemd/dashboard-rpi5-log-broker.service",
    "ops/systemd/dashboard-rpi5-docker-broker.service",
    "ops/systemd/dashboard-rpi5-terminal.socket",
    "ops/systemd/dashboard-rpi5-terminal@.service",
    "tools/package-terminal-native-runtime.mjs",
    "tools/production-candidate-manifest.mjs",
    "tools/production-runtime-smoke.mjs",
    "tools/production-release-controller.mjs",
    "tools/production-host-readiness.mjs",
  ];
  assert.deepEqual(PRODUCTION_CANDIDATE_CONTROLLER_BOOTSTRAP_V1_FILE_ROOTS, expected);
  assert.deepEqual(productionCandidateFileRoots(PRODUCTION_CANDIDATE_PROFILE_CONTROLLER_BOOTSTRAP_V1), expected);
  assert.ok(expected.includes("tools/production-candidate-manifest.mjs"));
  assert.ok(expected.includes("tools/production-release-controller.mjs"));
});

test("controller bootstrap profile is explicit and default full closure remains unchanged", async () => {
  const root = await createFixture();
  try {
    const full = await createProductionCandidateManifest({ rootDir: root, sourceSha: SHA });
    const bootstrap = await createProductionCandidateManifest({
      rootDir: root,
      sourceSha: SHA,
      profile: PRODUCTION_CANDIDATE_PROFILE_CONTROLLER_BOOTSTRAP_V1,
    });
    const fullPaths = new Set(full.files.map((file) => file.path));
    const bootstrapPaths = new Set(bootstrap.files.map((file) => file.path));
    for (const path of [
      "ops/production/container-metrics-source-contract.json",
      "ops/production/container-metrics-activation-contract.json",
      "ops/production/container-metrics-firewall-contract.json",
      "ops/production/controller-bootstrap-provenance-contract.json",
      "ops/production/container-metrics-exporter.env.example",
      "ops/prometheus/container-metrics-scrape.yml",
      "ops/systemd/dashboard-rpi5-container-metrics-exporter.service",
    ]) {
      assert.equal(fullPaths.has(path), true);
      assert.equal(bootstrapPaths.has(path), false);
    }
    assert.equal("profile" in bootstrap, false);
    assert.equal("compatibility" in bootstrap, false);
    assert.equal(bootstrap.schema, full.schema);
    assert.notEqual(bootstrap.candidateSha256, full.candidateSha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unknown production candidate profiles fail closed", () => {
  assert.throws(() => productionCandidateFileRoots("legacy-ish"), /unknown production candidate profile/u);
});


test("controller bootstrap provenance contract binds merged PR head to tree-equivalent main", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../ops/production/controller-bootstrap-provenance-contract.json", import.meta.url), "utf8"),
  );
  assert.equal(contract.schema, "dashboard-rpi5.controller-bootstrap-provenance.v2");
  assert.equal(contract.sourceOnly, true);
  assert.equal(contract.profile, PRODUCTION_CANDIDATE_PROFILE_CONTROLLER_BOOTSTRAP_V1);
  assert.equal(contract.bridgeSource.requiredProvenance, "merged-pr-exact-head");
  assert.equal(contract.bridgeSource.requiresMergedPullRequest, true);
  assert.equal(contract.bridgeSource.requiresExactHeadCiSuccess, true);
  assert.equal(contract.bridgeSource.requiresTreeEqualityWithSquashMergeMain, true);
  assert.equal(contract.bridgeSource.requiresDistinctShaFromFullMain, true);
  assert.equal(contract.fullSource.requiredProvenance, "fresh-current-main");
  assert.equal(contract.fullSource.requiresExactMainCiSuccess, true);
  assert.equal(contract.fullSource.requiresDifferentShaFromBridge, true);
  for (const forbidden of [
    "unmerged-pr-head",
    "tree-mismatch",
    "same-sha-full-expansion",
    "in-place-immutable-release-expansion",
    "empty-or-noop-commit-created-only-to-manufacture-sha",
  ]) {
    assert.ok(contract.forbidden.includes(forbidden));
  }
  assert.equal(contract.runtimeValuesStoredInSource, false);
  assert.equal(contract.liveMutationAuthorized, false);
});
