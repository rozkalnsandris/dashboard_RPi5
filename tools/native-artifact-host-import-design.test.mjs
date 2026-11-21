import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  loadHostImportDesignEvidence,
  validateHostImportSourceDesign,
  validateProposedHostImportMetadata,
} from "./native-artifact-host-import-design.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
const evidence = await loadHostImportDesignEvidence();

test("native host import is a fail-closed source-only design", () => {
  assert.deepStrictEqual(validateHostImportSourceDesign(evidence), {
    status: "SOURCE_DESIGN_VALID_NOT_IMPORTABLE",
    hostImporterImplemented: false,
    liveMutation: false,
  });
});

for (const [label, change] of [
  ["automatic import", (e) => { e.design.authority.automaticImport = true; }],
  ["additional host import authority", (e) => { e.design.authority.importerImplemented = true; }],
  ["remove owner host mutation gate", (e) => { e.design.authority.importRequiresOwnerHostMutationApproval = false; }],
  ["permission escalation", (e) => { e.design.authority.permissionOrIdentityMutation = true; }],
  ["untrusted candidate root execution", (e) => { e.design.authority.candidateCodeRootExecution = true; }],
  ["mutable branch", (e) => { e.design.provenance.ref = "refs/heads/deploy"; }],
  ["untrusted mode", (e) => { e.design.archive.archiveModesOrOwnershipTrusted = true; }],
  ["automatic artifact cleanup", (e) => { e.design.authority.automaticCleanup = true; }],
  ["loosened current gate", (e) => { e.activation.applyGate.requiresExpectedCurrent = false; }],
  ["untrusted web runtime", (e) => { e.profile.gates.runCandidateControllerAsRoot = true; }],
  ["workflow upload on PR", (e) => {
    e.workflow = e.workflow.replace(
      "if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
      "if: always()",
    );
  }],
]) {
  test("source design fails closed: " + label, () => {
    const bad = clone(evidence);
    change(bad);
    assert.throws(() => validateHostImportSourceDesign(bad));
  });
}

const sha = "a".repeat(40);
const fileBytes = 5;
const filePath = "apps/server/dist/index.js";
const fileHash = createHash("sha256").update("hello", "utf8").digest("hex");
const core = {
  schema: "dashboard-rpi5.production-candidate.v1",
  sourceSha: sha,
  releasePath: "/opt/dashboard_RPi5/releases/" + sha,
  nodeMajor: 24,
  hashAlgorithm: "sha256",
  fileCount: 1,
  totalBytes: fileBytes,
  files: [{ path: filePath, bytes: fileBytes, sha256: fileHash }],
};
const candidateSha = createHash("sha256")
  .update(JSON.stringify(core), "utf8").digest("hex");
const positive = {
  sourceSha: sha,
  expectedCandidateSha256: candidateSha,
  run: {
    id: 4123, repository: "rozkalnsandris/dashboard_RPi5", workflow: "CI",
    event: "push", ref: "refs/heads/main", headSha: sha,
    conclusion: "success", nativeJobConclusion: "success",
    mergeGateConclusion: "success",
  },
  artifact: {
    runId: 4123, name: "dashboard-native-arm64-" + sha,
    digest: "sha256:" + "b".repeat(64), expired: false, sizeBytes: 16384,
  },
  manifest: { ...core, candidateSha256: candidateSha },
  receipt: {
    schema: "dashboard-rpi5.native-candidate-receipt.v1", sourceSha: sha,
    candidateSha256: candidateSha, fileCount: 1, totalBytes: fileBytes,
    platform: "linux", architecture: "arm64",
    status: "UNTRUSTED_SOURCE_ONLY_NOT_DEPLOYED", activationAuthorized: false,
  },
  entries: [
    { name: "candidate-manifest.json", kind: "regular-file", bytes: 512 },
    { name: "candidate-receipt.json", kind: "regular-file", bytes: 320 },
    { name: "candidate/" + filePath, kind: "regular-file", bytes: fileBytes },
  ],
};

test("metadata-only plan accepts exact source, manifest, receipt and ZIP member closure", () => {
  assert.deepStrictEqual(validateProposedHostImportMetadata(positive), {
    status: "DESIGN_METADATA_ONLY_NO_BYTE_OR_HOST_VERIFICATION",
    sourceSha: sha,
    candidateSha256: candidateSha,
    liveMutation: false,
  });
});

for (const [label, change] of [
  ["mutable source SHA", (x) => { x.sourceSha = "main"; }],
  ["unreviewed independent hash", (x) => { x.expectedCandidateSha256 = "f".repeat(64); }],
  ["wrong repository", (x) => { x.run.repository = "another/repo"; }],
  ["PR-generated artifact", (x) => { x.run.event = "pull_request"; }],
  ["mutable ref", (x) => { x.run.ref = "refs/heads/feature"; }],
  ["wrong build SHA", (x) => { x.run.headSha = "b".repeat(40); }],
  ["workflow not successful", (x) => { x.run.conclusion = "failure"; }],
  ["native check failed", (x) => { x.run.nativeJobConclusion = "skipped"; }],
  ["merge gate failed", (x) => { x.run.mergeGateConclusion = "failure"; }],
  ["artifact from other run", (x) => { x.artifact.runId = 99; }],
  ["wrong artifact name", (x) => { x.artifact.name = "latest"; }],
  ["expired artifact", (x) => { x.artifact.expired = true; }],
  ["malformed transport digest", (x) => { x.artifact.digest = "sha256:bad"; }],
  ["oversized ZIP", (x) => { x.artifact.sizeBytes = 1000000000; }],
  ["manifest core tamper", (x) => { x.manifest.files[0].sha256 = "f".repeat(64); }],
  ["manifest extra authority", (x) => { x.manifest.allowRoot = true; }],
  ["wrong manifest source", (x) => { x.manifest.sourceSha = "b".repeat(40); }],
  ["receipt wrong digest", (x) => { x.receipt.candidateSha256 = "f".repeat(64); }],
  ["receipt claims authorization", (x) => { x.receipt.activationAuthorized = true; }],
  ["wrong architecture", (x) => { x.receipt.architecture = "x64"; }],
  ["extra ZIP member", (x) => { x.entries.push({ name: "evil", kind: "regular-file", bytes: 1 }); }],
  ["path traversal", (x) => { x.entries[2].name = "candidate/../etc/shadow"; }],
  ["absolute ZIP path", (x) => { x.entries[2].name = "/etc/shadow"; }],
  ["backslash ZIP path", (x) => { x.entries[2].name = "candidate\\etc\\passwd"; }],
  ["ZIP symlink", (x) => { x.entries[2].kind = "symlink"; }],
  ["ZIP directory entry", (x) => { x.entries[2].kind = "directory"; }],
  ["duplicate ZIP entry", (x) => { x.entries[2].name = x.entries[1].name; }],
  ["missing ZIP entry", (x) => { x.entries.pop(); }],
  ["ZIP file size mismatch", (x) => { x.entries[2].bytes = 6; }],
  ["manifest JSON too large", (x) => { x.entries[0].bytes = 100000000; }],
  ["ZIP total expanded budget exceeded", (x) => {
    x.entries[0].bytes = 268435457;
  }],
]) {
  test("host import metadata rejects " + label, () => {
    const bad = clone(positive);
    change(bad);
    assert.throws(() => validateProposedHostImportMetadata(bad));
  });
}
