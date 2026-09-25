import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import test from "node:test";

import {
  PRODUCTION_CANDIDATE_CONTROLLER_TRANSITION_V1_FILE_ROOTS,
  PRODUCTION_CANDIDATE_FILE_ROOTS,
  PRODUCTION_CANDIDATE_PROFILE_CONTROLLER_TRANSITION_V1,
  productionCandidateFileRoots,
} from "./production-candidate-manifest.mjs";

const TRUSTED_BRIDGE_CONTROLLER_SHA = "bc4cc9f1d49b97d8c5df65158640c4e3df3e7769";
const PROVENANCE_CONTRACT_PATH = "ops/production/controller-bootstrap-provenance-contract.json";

const TRUSTED_BRIDGE_FULL_FILE_ROOTS = [
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
  "ops/production/container-metrics-source-contract.json",
  "ops/production/container-metrics-activation-contract.json",
  "ops/production/container-metrics-firewall-contract.json",
  "ops/production/container-metrics-exporter.env.example",
  "ops/prometheus/container-metrics-scrape.yml",
  "ops/systemd/dashboard-rpi5-web.service",
  "ops/systemd/dashboard-rpi5-agent.service",
  "ops/systemd/dashboard-rpi5-log-broker.service",
  "ops/systemd/dashboard-rpi5-docker-broker.service",
  "ops/systemd/dashboard-rpi5-container-metrics-exporter.service",
  "ops/systemd/dashboard-rpi5-terminal.socket",
  "ops/systemd/dashboard-rpi5-terminal@.service",
  "tools/package-terminal-native-runtime.mjs",
  "tools/production-candidate-manifest.mjs",
  "tools/production-runtime-smoke.mjs",
  "tools/production-release-controller.mjs",
  "tools/production-host-readiness.mjs",
];

test("controller transition v1 is frozen to the trusted bridge full closure", () => {
  assert.equal(TRUSTED_BRIDGE_FULL_FILE_ROOTS.length, 33);
  assert.deepEqual(PRODUCTION_CANDIDATE_CONTROLLER_TRANSITION_V1_FILE_ROOTS, TRUSTED_BRIDGE_FULL_FILE_ROOTS);
  assert.deepEqual(productionCandidateFileRoots(PRODUCTION_CANDIDATE_PROFILE_CONTROLLER_TRANSITION_V1), TRUSTED_BRIDGE_FULL_FILE_ROOTS);

  const currentFullWithoutProvenance = PRODUCTION_CANDIDATE_FILE_ROOTS.filter(
    (path) => path !== PROVENANCE_CONTRACT_PATH,
  );
  assert.deepEqual(currentFullWithoutProvenance, TRUSTED_BRIDGE_FULL_FILE_ROOTS);
  assert.equal(PRODUCTION_CANDIDATE_FILE_ROOTS.includes(PROVENANCE_CONTRACT_PATH), true);
  assert.equal(PRODUCTION_CANDIDATE_CONTROLLER_TRANSITION_V1_FILE_ROOTS.includes(PROVENANCE_CONTRACT_PATH), false);
});

test("controller transition provenance binds the exact bridge and immutable second hop", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../ops/production/controller-bootstrap-provenance-contract.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.schema, "dashboard-rpi5.controller-bootstrap-provenance.v2");
  assert.equal(contract.sourceOnly, true);
  assert.equal(contract.bootstrapProfile, "controller-bootstrap-v1");
  assert.equal(contract.transitionProfile, PRODUCTION_CANDIDATE_PROFILE_CONTROLLER_TRANSITION_V1);
  assert.equal(contract.transitionController.trustedControllerSourceSha, TRUSTED_BRIDGE_CONTROLLER_SHA);
  assert.equal(contract.transitionController.requiredFileRootCount, TRUSTED_BRIDGE_FULL_FILE_ROOTS.length);
  assert.equal(contract.transitionController.requiresExactFileRootEquality, true);
  assert.equal(contract.transitionSource.requiredProvenance, "merged-pr-exact-head");
  assert.equal(contract.transitionSource.requiresMergedPullRequest, true);
  assert.equal(contract.transitionSource.requiresExactHeadCiSuccess, true);
  assert.equal(contract.transitionSource.requiresTreeEqualityWithSquashMergeMain, true);
  assert.equal(contract.transitionSource.requiresDistinctShaFromFullMain, true);
  assert.equal(contract.fullSource.requiredProvenance, "fresh-current-main");
  assert.equal(contract.fullSource.requiresExactMainCiSuccess, true);
  assert.equal(contract.fullSource.requiresDifferentShaFromBridge, true);
  assert.equal(contract.fullSource.requiresDifferentShaFromTransition, true);
  assert.equal(contract.fullSource.requiresTreeEqualityWithTransition, true);
  assert.deepEqual(contract.sequence, ["controller-bootstrap-v1", "controller-transition-v1", "full"]);
  for (const forbidden of [
    "unmerged-pr-head",
    "tree-mismatch",
    "transition-profile-root-drift",
    "same-sha-full-expansion",
    "same-sha-transition-full-expansion",
    "in-place-immutable-release-expansion",
    "empty-or-noop-commit-created-only-to-manufacture-sha",
  ]) {
    assert.ok(contract.forbidden.includes(forbidden));
  }
  assert.equal(contract.runtimeValuesStoredInSource, false);
  assert.equal(contract.liveMutationAuthorized, false);
});
