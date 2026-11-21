import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateCandidateManifestShape } from "./production-candidate-manifest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
const GITHUB_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const DAY_MS = 24 * 60 * 60 * 1000;

function githubTimestamp(value, label) {
  assert.match(value ?? "", GITHUB_UTC_TIMESTAMP, label + " must be GitHub UTC");
  const millis = Date.parse(value);
  assert.ok(Number.isFinite(millis) &&
    new Date(millis).toISOString().slice(0, 19) + "Z" === value,
  label + " must be a valid canonical timestamp");
  return millis;
}
const FIELDS = [
  "schema", "sourceSha", "releasePath", "nodeMajor", "hashAlgorithm",
  "fileCount", "totalBytes", "files", "candidateSha256",
];

export const ACCEPTED_HOST_IMPORT_DESIGN = Object.freeze({
  "schema": "dashboard-rpi5.native-artifact-host-import-design.v1",
  "repository": "rozkalnsandris/dashboard_RPi5",
  "status": "SOURCE_DESIGN_ONLY_NO_HOST_IMPORT",
  "provenance": {
    "workflow": ".github/workflows/ci.yml",
    "workflowName": "CI",
    "nativeJob": "Native ARM64 candidate (source only)",
    "mergeGate": "FAST-LANE Merge Gate",
    "event": "push",
    "ref": "refs/heads/main",
    "artifactPrefix": "dashboard-native-arm64-",
    "retentionDays": 7,
    "requireAuthenticatedGitHubRunMetadata": true,
    "requireExactMainSourceSha": true,
    "requireSuccessfulNativeAndMergeGate": true,
    "requireUnexpiredSingleRunArtifact": true,
    "transportDigestIsCandidateDigest": false,
    "attestationAuthorityActive": false
  },
  "archive": {
    "format": "github-actions-zip-untrusted",
    "manifestMember": "candidate-manifest.json",
    "receiptMember": "candidate-receipt.json",
    "candidatePrefix": "candidate/",
    "allowedMemberKind": "regular-file-only",
    "maxArchiveBytes": 67108864,
    "maxExpandedBytes": 268435456,
    "maxSingleFileBytes": 67108864,
    "maxMembers": 8192,
    "maxManifestBytes": 4194304,
    "maxReceiptBytes": 65536,
    "pathNormalizationAllowed": false,
    "symlinkOrHardlinkAllowed": false,
    "specialFilesAllowed": false,
    "duplicateOrExtraMembersAllowed": false,
    "archiveModesOrOwnershipTrusted": false,
    "unprivilegedExclusiveQuarantineRequired": true,
    "canonicalHeaderAndBoundsVerificationRequired": true,
    "descriptorSafeNoFollowExtractionRequired": true,
    "importerTargetBound": false
  },
  "candidate": {
    "manifestSchema": "dashboard-rpi5.production-candidate.v1",
    "manifestProfile": "full",
    "receiptSchema": "dashboard-rpi5.native-candidate-receipt.v1",
    "receiptStatus": "UNTRUSTED_SOURCE_ONLY_NOT_DEPLOYED",
    "platform": "linux",
    "architecture": "arm64",
    "requireIndependentExpectedCandidateSha256": true,
    "requireManifestCoreAndExactMemberClosure": true,
    "requireIndependentFileByteHashVerification": true,
    "candidateRootTrustedAsCode": false
  },
  "activation": {
    "root": "/opt/dashboard_RPi5",
    "controllerSource": "verified-current-root-owned-release-only",
    "requireFreshExpectedCurrent": true,
    "requireFreshExpectedCandidateSha256": true,
    "trustedPlanRequired": true,
    "exclusiveApplyLock": true,
    "ownerLiveEveryRelease": true,
    "webRestartRequiresSeparateNamedLivePermission": true
  },
  "authority": {
    "importerImplemented": false,
    "automaticDownload": false,
    "automaticImport": false,
    "automaticDeploy": false,
    "candidateCodeRootExecution": false,
    "importRequiresOwnerHostMutationApproval": true,
    "mergeAuthorizesLive": false,
    "permissionOrIdentityMutation": false,
    "secretOrCloudflareMutation": false,
    "dockerAuthorityExpansion": false,
    "systemdOrServiceMutation": false,
    "automaticRetry": false,
    "automaticRollback": false,
    "automaticCleanup": false
  }
});

export async function loadHostImportDesignEvidence(root = ROOT) {
  const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
  const [design, activation, profile, workflow, candidateScript] = await Promise.all([
    readJson("ops/production/native-artifact-host-import-design.json"),
    readJson("ops/production/release-activation-contract.json"),
    readJson("ops/production/native-release-profile.json"),
    readFile(resolve(root, ".github/workflows/ci.yml"), "utf8"),
    readFile(resolve(root, "tools/native-release-candidate-bundle.mjs"), "utf8"),
  ]);
  return { design, activation, profile, workflow, candidateScript };
}

// Source-only invariant check. No archive, host, networking, subprocess or mutation.
export function validateHostImportSourceDesign(evidence) {
  assert.deepStrictEqual(evidence.design, ACCEPTED_HOST_IMPORT_DESIGN,
    "native host import source design drift");
  const { activation, profile, workflow, candidateScript } = evidence;
  assert.equal(activation.productionRoot, ACCEPTED_HOST_IMPORT_DESIGN.activation.root);
  assert.equal(activation.releaseDirectory, "exact-source-sha");
  assert.equal(activation.applyGate.requiresExpectedCurrent, true);
  assert.equal(activation.applyGate.requiresExpectedCandidateSha256, true);
  assert.equal(activation.releaseMetadata.owner, "root");
  assert.equal(activation.releaseMetadata.group, "root");
  assert.equal(activation.exclusiveApplyLock, true);
  assert.equal(activation.staleLockAutoCleanup, false);
  assert.equal(activation.processExecutionAllowed, false);
  assert.equal(profile.status, "SOURCE_ONLY_NOT_ACTIVATED");
  assert.equal(profile.gates.automaticDeploy, false);
  assert.equal(profile.gates.ownerLiveEveryRelease, true);
  assert.equal(profile.gates.runCandidateControllerAsRoot, false);
  assert.ok(workflow.includes("name: Native ARM64 candidate (source only)"),
    "native CI job is absent");
  assert.ok(workflow.includes("if: github.event_name == 'push' && github.ref == 'refs/heads/main'"),
    "source-only main artifact publication gate is absent");
  assert.ok(workflow.includes("retention-days: 7"), "artifact retention gate drift");
  assert.ok(workflow.includes("name: dashboard-native-arm64-"), "artifact identity drift");
  assert.ok(workflow.includes("permissions:\n      contents: read"), "CI permission scope drift");
  assert.ok(candidateScript.includes('status: "UNTRUSTED_SOURCE_ONLY_NOT_DEPLOYED"'),
    "receipt untrusted-state marker drift");
  assert.ok(candidateScript.includes('activationAuthorized: false'),
    "receipt authorization marker drift");
  return {
    status: "SOURCE_DESIGN_VALID_NOT_IMPORTABLE",
    hostImporterImplemented: false,
    liveMutation: false,
  };
}

function safeMember(name) {
  assert.ok(typeof name === "string" && name.length > 0 && !name.includes("\\")
    && !name.includes("\u0000") && !name.startsWith("/"),
  "unsafe ZIP member path");
  const segments = name.split("/");
  assert.ok(segments.every((part) => part.length > 0 && part !== "." && part !== "..")
    && !/^[A-Za-z]:/u.test(segments[0]), "non-canonical ZIP member path");
  return name;
}

// Pure metadata planning only, not a ZIP decoder or a trusted host acceptance.
export function validateProposedHostImportMetadata({
  sourceSha, expectedMainSha, expectedCandidateSha256, observedAt,
  run, artifact, manifest, receipt, entries,
}) {
  const policy = ACCEPTED_HOST_IMPORT_DESIGN;
  assert.match(sourceSha ?? "", SHA, "exact source SHA required");
  assert.match(expectedMainSha ?? "", SHA, "fresh exact main SHA required");
  assert.equal(sourceSha, expectedMainSha, "selected artifact is not exact current main");
  assert.match(expectedCandidateSha256 ?? "", DIGEST,
    "independent owner-pinned candidate digest required");
  const observedMillis = githubTimestamp(observedAt, "observation time");

  assert.ok(run && typeof run === "object");
  assert.ok(Number.isSafeInteger(run.id) && run.id > 0, "GitHub run id required");
  assert.ok(Number.isSafeInteger(run.attempt) && run.attempt > 0,
    "GitHub run attempt required");
  assert.ok(Number.isSafeInteger(run.repositoryId) && run.repositoryId > 0,
    "GitHub repository id required");
  assert.equal(run.headRepositoryId, run.repositoryId,
    "run must originate in the canonical repository");
  assert.equal(run.repository, policy.repository);
  assert.equal(run.workflow, policy.provenance.workflowName);
  assert.equal(run.workflowPath, policy.provenance.workflow);
  assert.equal(run.event, policy.provenance.event);
  assert.equal(run.ref, policy.provenance.ref);
  assert.equal(run.headBranch, "main");
  assert.equal(run.headSha, sourceSha);
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  assert.equal(run.nativeJobConclusion, "success");
  assert.equal(run.mergeGateConclusion, "success");
  const runCreatedMillis = githubTimestamp(run.createdAt, "run createdAt");
  assert.ok(runCreatedMillis <= observedMillis, "run date is in the future");

  assert.ok(artifact && typeof artifact === "object");
  assert.ok(Number.isSafeInteger(artifact.id) && artifact.id > 0,
    "GitHub artifact id required");
  assert.equal(artifact.matchingNameCount, 1,
    "exactly one matching artifact must appear in the complete run artifact list");
  assert.equal(artifact.runId, run.id);
  assert.equal(artifact.name, policy.provenance.artifactPrefix + sourceSha);
  assert.match(artifact.digest ?? "", /^sha256:[a-f0-9]{64}$/u,
    "GitHub transport ZIP SHA-256 required");
  assert.equal(artifact.expired, false);
  assert.ok(artifact.workflowRun && typeof artifact.workflowRun === "object",
    "artifact must link to its authenticated workflow run");
  assert.equal(artifact.workflowRun.id, run.id);
  assert.equal(artifact.workflowRun.repositoryId, run.repositoryId);
  assert.equal(artifact.workflowRun.headRepositoryId, run.headRepositoryId);
  assert.equal(artifact.workflowRun.headBranch, run.headBranch);
  assert.equal(artifact.workflowRun.headSha, sourceSha);
  const created = githubTimestamp(artifact.createdAt, "artifact createdAt");
  const expires = githubTimestamp(artifact.expiresAt, "artifact expiresAt");
  assert.ok(created >= runCreatedMillis && created <= observedMillis,
    "artifact creation is outside the observed workflow run");
  assert.ok(expires > observedMillis && expires > created,
    "artifact expires before acceptance");
  assert.ok(expires - created <= policy.provenance.retentionDays * DAY_MS,
    "artifact retention exceeds the reviewed seven-day window");
  assert.ok(Number.isSafeInteger(artifact.sizeBytes) && artifact.sizeBytes > 0
    && artifact.sizeBytes <= policy.archive.maxArchiveBytes,
  "artifact ZIP exceeds transport budget");

  validateCandidateManifestShape(manifest, sourceSha);
  assert.deepStrictEqual(Object.keys(manifest), FIELDS,
    "manifest must be canonical and contain no extra claims");
  assert.ok(manifest.fileCount <= policy.archive.maxMembers - 2,
    "candidate file count exceeds ZIP budget");
  assert.ok(manifest.totalBytes <= policy.archive.maxExpandedBytes,
    "manifest expanded bytes exceed budget");
  assert.equal(manifest.files.length, manifest.fileCount);
  const { candidateSha256, ...core } = manifest;
  assert.equal(candidateSha256,
    createHash("sha256").update(JSON.stringify(core), "utf8").digest("hex"),
  "manifest core digest mismatch");
  assert.equal(candidateSha256, expectedCandidateSha256,
    "candidate SHA-256 not independently pinned");

  assert.ok(receipt && typeof receipt === "object");
  assert.deepStrictEqual(Object.keys(receipt), [
    "schema", "sourceSha", "candidateSha256", "fileCount", "totalBytes",
    "platform", "architecture", "status", "activationAuthorized",
  ], "receipt must have only reviewed fields");
  assert.equal(receipt.schema, policy.candidate.receiptSchema);
  assert.equal(receipt.sourceSha, sourceSha);
  assert.equal(receipt.candidateSha256, candidateSha256);
  assert.equal(receipt.fileCount, manifest.fileCount);
  assert.equal(receipt.totalBytes, manifest.totalBytes);
  assert.equal(receipt.platform, policy.candidate.platform);
  assert.equal(receipt.architecture, policy.candidate.architecture);
  assert.equal(receipt.status, policy.candidate.receiptStatus);
  assert.equal(receipt.activationAuthorized, false);

  const expectedPaths = new Map([
    [policy.archive.manifestMember, null],
    [policy.archive.receiptMember, null],
  ]);
  let total = 0;
  let previous = "";
  for (const entry of manifest.files) {
    assert.deepStrictEqual(Object.keys(entry), ["path", "bytes", "sha256"]);
    safeMember(entry.path);
    assert.ok(!entry.path.split("/").includes("node_modules")
      && entry.path !== ".dashboard-production-candidate.json",
    "manifest contains a reserved release path");
    assert.ok(entry.path > previous, "manifest must be strictly sorted");
    previous = entry.path;
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0
      && entry.bytes <= policy.archive.maxSingleFileBytes,
    "manifest member size exceeds budget");
    assert.match(entry.sha256, DIGEST);
    total += entry.bytes;
    expectedPaths.set(policy.archive.candidatePrefix + entry.path, entry.bytes);
  }
  assert.equal(total, manifest.totalBytes, "manifest total byte count mismatch");
  assert.equal(expectedPaths.size, manifest.fileCount + 2,
    "candidate archive contains overlapping paths");

  assert.ok(Array.isArray(entries) && entries.length === expectedPaths.size
    && entries.length <= policy.archive.maxMembers,
  "ZIP archive member cardinality mismatch");
  const seen = new Set();
  let extracted = 0;
  for (const entry of entries) {
    assert.deepStrictEqual(Object.keys(entry), ["name", "kind", "bytes"]);
    safeMember(entry.name);
    assert.equal(entry.kind, "regular-file", "ZIP special member forbidden");
    assert.ok(!seen.has(entry.name), "duplicate ZIP member");
    seen.add(entry.name);
    assert.ok(expectedPaths.has(entry.name), "unknown ZIP member");
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0
      && entry.bytes <= policy.archive.maxSingleFileBytes,
    "ZIP member bytes exceed budget");
    const expected = expectedPaths.get(entry.name);
    if (expected !== null) assert.equal(entry.bytes, expected, "ZIP member size drift");
    if (entry.name === policy.archive.manifestMember) {
      assert.ok(entry.bytes > 0 && entry.bytes <= policy.archive.maxManifestBytes,
        "manifest JSON exceeds budget");
    }
    if (entry.name === policy.archive.receiptMember) {
      assert.ok(entry.bytes > 0 && entry.bytes <= policy.archive.maxReceiptBytes,
        "receipt JSON exceeds budget");
    }
    extracted += entry.bytes;
    assert.ok(extracted <= policy.archive.maxExpandedBytes,
      "ZIP expanded byte budget exceeded");
  }
  return {
    status: "DESIGN_METADATA_ONLY_NO_BYTE_OR_HOST_VERIFICATION",
    sourceSha,
    candidateSha256,
    liveMutation: false,
  };
}
