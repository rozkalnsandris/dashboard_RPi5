import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_CANDIDATE_DIRECTORY_ROOTS,
  PRODUCTION_CANDIDATE_FILE_ROOTS,
} from "./production-candidate-manifest.mjs";

// Duplicated deliberately: fail closed if the reviewed policy JSON drifts.
export const ACCEPTED_NATIVE_RELEASE_PROFILE = Object.freeze({
  "schema": "dashboard-rpi5.native-release-profile.v1",
  "repository": "rozkalnsandris/dashboard_RPi5",
  "status": "SOURCE_ONLY_NOT_ACTIVATED",
  "artifact": {
    "identity": "exact-40hex-commit",
    "architecture": "arm64",
    "manifestProfile": "full",
    "candidateSha256Required": true
  },
  "release": {
    "root": "/opt/dashboard_RPi5",
    "releases": "/opt/dashboard_RPi5/releases",
    "current": "/opt/dashboard_RPi5/current",
    "lock": "/opt/dashboard_RPi5/.dashboard-release-controller.lock",
    "trustedController": "/opt/dashboard_RPi5/releases/<verified-current-sha>/tools/production-release-controller.mjs"
  },
  "runtime": {
    "kind": "native-systemd",
    "webUnit": "dashboard-rpi5-web.service",
    "webUser": "dashboard-rpi5-web",
    "webGroup": "dashboard-rpi5-web",
    "webExecStart": "/usr/bin/node /opt/dashboard_RPi5/current/apps/server/dist/index.js",
    "agentSocket": "/run/dashboard-rpi5/agent.sock",
    "dockerAuthority": "dedicated-broker-only",
    "dockerSocketToWeb": false,
    "compose": false
  },
  "gates": {
    "automaticDeploy": false,
    "mergeAuthorizesLive": false,
    "ownerLiveEveryRelease": true,
    "ownerLiveForRestart": true,
    "runCandidateControllerAsRoot": false,
    "expectedCurrent": true,
    "expectedCandidateSha256": true,
    "automaticRetry": false,
    "automaticRollback": false,
    "automaticCleanup": false,
    "cloudflareMutation": false,
    "permissionOrSecretsMutation": false,
    "dockerAuthorityExpansion": false
  }
});
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (root, file) =>
  JSON.parse(await readFile(resolve(root, file), "utf8"));

export async function loadNativeReleaseEvidence(root = ROOT) {
  const [profile, launch, activation, webUnit] = await Promise.all([
    readJson(root, "ops/production/native-release-profile.json"),
    readJson(root, "ops/production/launch-contract.json"),
    readJson(root, "ops/production/release-activation-contract.json"),
    readFile(resolve(root, "ops/systemd/dashboard-rpi5-web.service"), "utf8"),
  ]);
  return {
    profile, launch, activation, webUnit,
    dirs: [...PRODUCTION_CANDIDATE_DIRECTORY_ROOTS],
    files: [...PRODUCTION_CANDIDATE_FILE_ROOTS],
  };
}

// Pure source validation. No network, subprocesses, host probing or mutations.
export function validateNativeReleaseEvidence(e) {
  assert.deepStrictEqual(e.profile, ACCEPTED_NATIVE_RELEASE_PROFILE,
    "native release source-only policy drift");
  const { launch: l, activation: a, webUnit: u } = e;
  const { release: r, runtime: rt } = ACCEPTED_NATIVE_RELEASE_PROFILE;
  assert.equal(l.release.root, r.releases);
  assert.equal(l.release.current, r.current);
  assert.equal(l.web.user, rt.webUser);
  assert.equal(l.web.group, rt.webGroup);
  assert.equal(l.web.agentSocket, rt.agentSocket);
  assert.equal(l.web.terminalEnabledByDefault, false);

  assert.equal(a.sourceOnly, true);
  assert.equal(a.productionRoot, r.root);
  assert.equal(a.releasesRoot, r.releases);
  assert.equal(a.currentLink, r.current);
  assert.equal(a.applyLock, r.lock);
  assert.equal(a.releaseDirectory, "exact-source-sha");
  assert.equal(a.releaseMetadata.owner, "root");
  assert.equal(a.releaseMetadata.group, "root");
  assert.equal(a.releaseMetadata.directoryMode, "0755");
  assert.equal(a.releaseMetadata.regularFileMode, "0644");
  assert.equal(a.atomicPointerSwap, true);
  assert.equal(a.exclusiveApplyLock, true);
  assert.equal(a.staleLockAutoCleanup, false);
  assert.equal(a.failureEvidence.postMutationFailurePreservesApplyLock, true);
  assert.equal(a.failureEvidence.manualCleanupRequired, true);
  for (const denied of [
    "networkAllowed", "processExecutionAllowed", "systemdMutationAllowed",
    "identityMutationAllowed", "cloudflareMutationAllowed",
  ]) assert.equal(a[denied], false, `unexpected activation authority: ${denied}`);
  assert.equal(a.applyGate.flag, "--apply");
  assert.equal(a.applyGate.acknowledgement,
    "I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ACTIVATION");
  assert.equal(a.applyGate.requiresExpectedCurrent, true);
  assert.equal(a.applyGate.requiresExpectedCandidateSha256, true);

  const lines = u.split(/\r?\n/u).map((line) => line.trim());
  for (const required of [
    `User=${rt.webUser}`, `Group=${rt.webGroup}`,
    "SupplementaryGroups=dashboard-rpi5-agent-client",
    `ExecStart=${rt.webExecStart}`,
    "WorkingDirectory=/opt/dashboard_RPi5/current",
    "NoNewPrivileges=yes", "CapabilityBoundingSet=",
  ]) assert.ok(lines.includes(required), `missing restricted web unit line: ${required}`);
  assert.ok(!u.includes("/var/run/docker.sock"), "web cannot own Engine socket");
  assert.ok(!lines.some((line) => /^SupplementaryGroups=.*\bdocker\b/u.test(line)),
    "web cannot join Docker group");

  for (const required of [
    "apps/web/dist", "apps/server/dist", "apps/agent/dist",
    "apps/terminal-agent/dist", "packages/contracts/dist",
  ]) assert.ok(e.dirs.includes(required), `missing candidate directory: ${required}`);
  for (const required of [
    "tools/production-release-controller.mjs",
    "tools/production-candidate-manifest.mjs",
    "tools/production-runtime-smoke.mjs",
    "ops/production/release-activation-contract.json",
    "ops/systemd/dashboard-rpi5-web.service",
    "ops/systemd/dashboard-rpi5-docker-broker.service",
    "ops/systemd/dashboard-rpi5-terminal.socket",
  ]) assert.ok(e.files.includes(required), `missing candidate file: ${required}`);

  return {
    status: "SOURCE_ONLY_PROFILE_VALID",
    schema: ACCEPTED_NATIVE_RELEASE_PROFILE.schema,
    automaticDeploy: false,
    liveMutation: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(validateNativeReleaseEvidence(await loadNativeReleaseEvidence()))}\n`);
  } catch (error) {
    process.stderr.write(`NATIVE_RELEASE_PROFILE_FAIL_CLOSED: ${error.message}\n`);
    process.exitCode = 1;
  }
}
