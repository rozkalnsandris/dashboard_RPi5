import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import { validateProposedHostImportMetadata } from "./native-artifact-host-import-design.mjs";
import { verifyNativeArtifactCandidateClosure } from "./native-artifact-manifest-closure.mjs";

/**
 * Source-only dry-run admission of caller-projected GitHub metadata and ZIP bytes.
 * The caller MUST obtain run/artifact metadata and independent candidate digest
 * from separately trusted sources. This function does not authenticate either.
 *
 * No network, filesystem, host execution, import, or deployment.
 */
export function verifyNativeArtifactDryRunEvidence({
  archive, observedAt, run, artifact, expectedMainSha, expectedCandidateSha256,
}) {
  assert.ok(Buffer.isBuffer(archive), "ZIP bytes must be a Buffer");
  assert.ok(artifact && typeof artifact === "object", "artifact metadata required");
  assert.equal(artifact.sizeBytes, archive.length,
    "authenticated artifact size and ZIP length mismatch");
  const sourceSha = run?.headSha;
  const contents = verifyNativeArtifactCandidateClosure({
    archive,
    transportDigest: artifact.digest,
    sourceSha,
    expectedCandidateSha256,
    includeValidatedMetadata: true,
  });
  assert.equal(contents.status, "ZIP_MANIFEST_BYTES_CLOSED_NOT_AUTHORIZED_FOR_HOST");
  assert.ok(contents.validatedMetadata, "validated ZIP metadata required");

  const metadata = validateProposedHostImportMetadata({
    sourceSha, expectedMainSha, expectedCandidateSha256, observedAt,
    run, artifact, ...contents.validatedMetadata,
  });
  assert.equal(metadata.status, "DESIGN_METADATA_ONLY_NO_BYTE_OR_HOST_VERIFICATION");
  assert.equal(metadata.sourceSha, contents.sourceSha);
  assert.equal(metadata.candidateSha256, contents.candidateSha256);

  return {
    status: "NATIVE_ARTIFACT_SOURCE_ONLY_EVIDENCE_CLOSED_NO_HOST_AUTHORITY",
    sourceSha: contents.sourceSha,
    candidateSha256: contents.candidateSha256,
    transportSha256: artifact.digest,
    artifactId: artifact.id,
    runId: run.id,
    fileCount: contents.fileCount,
    totalBytes: contents.totalBytes,
    liveMutation: false,
  };
}
