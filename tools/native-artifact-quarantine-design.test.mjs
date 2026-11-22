import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

const read = async path => JSON.parse(await readFile(new URL("../" + path, import.meta.url), "utf8"));
const policy = await read("ops/production/native-artifact-quarantine-design.json");
const hostImport = await read("ops/production/native-artifact-host-import-design.json");
const profile = await read("ops/production/native-release-profile.json");
const controller = await read("ops/production/release-activation-contract.json");

function requireQuarantineBoundary(p) {
  assert.equal(p.schema, "dashboard-rpi5.native-artifact-quarantine-design.v1");
  assert.equal(p.repository, "rozkalnsandris/dashboard_RPi5");
  assert.equal(p.status, "SOURCE_DESIGN_ONLY_NO_HOST_IMPORTER");
  for (const key of Object.keys(p.provenance)) assert.equal(p.provenance[key], true, "provenance " + key);
  assert.equal(p.quarantine.approvedParent, "NOT_SELECTED");
  assert.equal(p.quarantine.approvedTarget, "NOT_SELECTED");
  assert.equal(p.quarantine.hostTargetBound, false);
  assert.equal(p.quarantine.rootOutsideProductionReleaseTreeRequired, true);
  assert.equal(p.quarantine.importerIdentity, "unprivileged-dedicated");
  for (const key of ["exclusiveNewDirectoryRequired", "descriptorRelativeNoFollowRequired",
    "noSymlinksHardlinksOrSpecialFiles", "allowOnlyVerifiedManifestMembers"]) {
    assert.equal(p.quarantine[key], true, "quarantine " + key);
  }
  for (const key of ["archivePathOrModeControlsFilesystem", "executeCandidateCode",
    "useDockerSocketOrPrivilegedAgent"]) assert.equal(p.quarantine[key], false, "quarantine " + key);
  assert.equal(p.quarantine.directoryMode, "0700");
  assert.equal(p.quarantine.fileMode, "0600");
  for (const key of ["ownerAuthorizationBeforeFirstHostWrite", "oneBoundedImportOnly",
    "noOverwriteExistingTargets", "noMutableRefReResolution",
    "writeVerificationBeforeEvidenceReceipt"]) assert.equal(p.staging[key], true, "staging " + key);
  assert.equal(p.staging.receiptProvesDeployAuthority, false);
  assert.equal(p.staging.postWriteFailure, "PRESERVE_EVIDENCE_AND_STOP");
  for (const key of ["retry", "rollback", "automaticCleanup"]) assert.equal(p.staging[key], false);
  for (const key of ["quarantineIsNotProduction", "rootOwnedCurrentControllerOnly",
    "trustedControllerMustIndependentlyReverifyCandidate", "separateOwnerGateForTrustedPlan",
    "separateOwnerGateForApply", "restartMustBeExplicitlyIncludedInLiveGate",
    "noSystemdCloudflareDockerOrPermissionMutation"]) assert.equal(p.boundary[key], true, "boundary " + key);
  for (const key of Object.keys(p.authority)) assert.equal(p.authority[key], false, "authority " + key);
  return { status: "SOURCE_ONLY_QUARANTINE_BOUNDARY_VALID_NOT_EXECUTABLE", liveMutation: false };
}

test("quarantine design is source-only, not a host importer", () => {
  assert.deepEqual(requireQuarantineBoundary(policy), {
    status: "SOURCE_ONLY_QUARANTINE_BOUNDARY_VALID_NOT_EXECUTABLE", liveMutation: false,
  });
  assert.equal(hostImport.archive.importerTargetBound, false);
  assert.equal(hostImport.authority.importerImplemented, false);
  assert.equal(hostImport.authority.importRequiresOwnerHostMutationApproval, true);
  assert.equal(hostImport.archive.descriptorSafeNoFollowExtractionRequired, true);
  assert.equal(profile.status, "SOURCE_ONLY_NOT_ACTIVATED");
  assert.equal(profile.gates.ownerLiveEveryRelease, true);
  assert.equal(controller.releaseMetadata.owner, "root");
  assert.equal(controller.releaseMetadata.group, "root");
  assert.equal(controller.exclusiveApplyLock, true);
  assert.equal(controller.staleLockAutoCleanup, false);
  assert.equal(controller.applyGate.requiresExpectedCurrent, true);
  assert.equal(controller.applyGate.requiresExpectedCandidateSha256, true);
});

for (const [name, change] of [
  ["configured host target", p => { p.quarantine.approvedParent = "/tmp"; }],
  ["host-bound import", p => { p.quarantine.hostTargetBound = true; }],
  ["writes in the production tree", p => { p.quarantine.rootOutsideProductionReleaseTreeRequired = false; }],
  ["privileged importer", p => { p.quarantine.importerIdentity = "root"; }],
  ["reused extraction directory", p => { p.quarantine.exclusiveNewDirectoryRequired = false; }],
  ["path traversal via filesystem paths", p => { p.quarantine.descriptorRelativeNoFollowRequired = false; }],
  ["untrusted archive modes", p => { p.quarantine.archivePathOrModeControlsFilesystem = true; }],
  ["candidate execution", p => { p.quarantine.executeCandidateCode = true; }],
  ["writable/executable files", p => { p.quarantine.fileMode = "0755"; }],
  ["no prewrite owner gate", p => { p.staging.ownerAuthorizationBeforeFirstHostWrite = false; }],
  ["unchecked candidate evidence", p => { p.provenance.fullArchiveByteClosureBeforeAnyHostWrite = false; }],
  ["missing independent digest", p => { p.provenance.independentOwnerPinnedCandidateDigestRequired = false; }],
  ["automatic retry", p => { p.staging.retry = true; }],
  ["automatic cleanup", p => { p.staging.automaticCleanup = true; }],
  ["false deploy authority", p => { p.staging.receiptProvesDeployAuthority = true; }],
  ["candidate controller trusted", p => { p.boundary.rootOwnedCurrentControllerOnly = false; }],
  ["merging grants LIVE", p => { p.authority.mergeAuthorizesLive = true; }],
  ["accidental importer implementation", p => { p.authority.importerExecutableImplemented = true; }],
]) {
  test("quarantine design fails closed: " + name, () => {
    const bad = JSON.parse(JSON.stringify(policy));
    change(bad);
    assert.throws(() => requireQuarantineBoundary(bad));
  });
}
