import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { inflateRawSync } from "node:zlib";

import { validateCandidateManifestShape } from "./production-candidate-manifest.mjs";
import {
  verifyNativeArtifactZipEnvelope,
  verifyNativeArtifactZipPayload,
} from "./native-artifact-zip-envelope.mjs";

const SOURCE_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MANIFEST_KEYS = [
  "schema", "sourceSha", "releasePath", "nodeMajor", "hashAlgorithm",
  "fileCount", "totalBytes", "files", "candidateSha256",
];
const RECEIPT_KEYS = [
  "schema", "sourceSha", "candidateSha256", "fileCount", "totalBytes",
  "platform", "architecture", "status", "activationAuthorized",
];
const FILE_KEYS = ["path", "bytes", "sha256"];
const hash = value => createHash("sha256").update(value).digest("hex");

function canonicalObject(value, keys, label) {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value),
    label + " must be an object");
  assert.deepStrictEqual(Object.keys(value), keys, label + " fields are not canonical");
  return value;
}

function readCanonicalJson(archive, member, maximum, label, keys) {
  assert.ok(member && Number.isSafeInteger(member.compressedOffset) &&
    Number.isSafeInteger(member.bytes) && member.bytes > 0 &&
    member.bytes <= maximum, label + " size invalid");
  const compressed = archive.subarray(
    member.compressedOffset, member.compressedOffset + member.compressedBytes,
  );
  let bytes;
  if (member.method === 0) {
    bytes = compressed;
  } else {
    const inflated = inflateRawSync(compressed, {
      info: true, maxOutputLength: member.bytes,
    });
    assert.equal(inflated.engine.bytesWritten, member.compressedBytes,
      label + " trailing compressed bytes");
    bytes = inflated.buffer;
  }
  assert.equal(bytes.length, member.bytes, label + " byte count drift");
  const text = bytes.toString("utf8");
  assert.ok(Buffer.from(text, "utf8").equals(bytes), label + " invalid UTF-8");
  const parsed = JSON.parse(text);
  // The native candidate builder writes JSON.stringify(object) + newline.
  // A round-trip fails closed on duplicate JSON keys, alternate encodings,
  // noncanonical whitespace, reordered keys, and trailing data.
  assert.equal(text, JSON.stringify(parsed) + "\n",
    label + " noncanonical JSON or duplicate key");
  return canonicalObject(parsed, keys, label);
}

/**
 * Read-only ZIP-to-manifest byte closure. The caller-selected ZIP digest,
 * source SHA and candidate SHA are not authenticated by this function.
 * It does not download, extract to disk, import, or activate any candidate.
 */
export function verifyNativeArtifactCandidateClosure({
  archive, transportDigest, sourceSha, expectedCandidateSha256,
  includeValidatedMetadata = false,
}) {
  assert.match(sourceSha ?? "", SOURCE_SHA, "exact source SHA required");
  assert.match(expectedCandidateSha256 ?? "", SHA256,
    "independently pinned candidate SHA-256 required");

  const envelope = verifyNativeArtifactZipEnvelope(archive, transportDigest);
  const payload = verifyNativeArtifactZipPayload(archive, transportDigest);
  assert.equal(payload.status, "ZIP_PAYLOAD_BYTES_VERIFIED_NOT_RELEASE_VALIDATED");
  assert.equal(envelope.count, payload.entries.length, "ZIP member count mismatch");

  const headers = new Map(envelope.entries.map(member => [member.name, member]));
  const verified = new Map(payload.entries.map(entry => [entry.name, entry]));
  const manifest = readCanonicalJson(archive, headers.get("candidate-manifest.json"),
    4 * 1024 * 1024, "candidate manifest", MANIFEST_KEYS);
  const receipt = readCanonicalJson(archive, headers.get("candidate-receipt.json"),
    64 * 1024, "candidate receipt", RECEIPT_KEYS);

  validateCandidateManifestShape(manifest, sourceSha);
  assert.equal(manifest.files.length, manifest.fileCount, "manifest file count mismatch");
  assert.ok(manifest.fileCount <= 8190, "manifest file count exceeds ZIP budget");
  assert.ok(manifest.totalBytes <= 256 * 1024 * 1024,
    "manifest expanded byte limit exceeded");
  let previous = "";
  let total = 0;
  const names = new Set(["candidate-manifest.json", "candidate-receipt.json"]);
  for (const file of manifest.files) {
    canonicalObject(file, FILE_KEYS, "manifest entry");
    const path = file.path;
    assert.ok(typeof path === "string" && path > previous &&
      !path.startsWith("/") && !path.includes("\\") && !path.includes("\0") &&
      !/^[A-Za-z]:/u.test(path), "manifest file path is unsafe or not strictly sorted");
    assert.ok(path.split("/").every(segment =>
      segment && segment !== "." && segment !== ".." && segment !== "node_modules"),
    "manifest file contains reserved or unsafe segment");
    assert.notEqual(path, ".dashboard-production-candidate.json",
      "candidate manifest release marker forbidden");
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes >= 0 &&
      file.bytes <= 64 * 1024 * 1024, "manifest file length invalid");
    assert.match(file.sha256 ?? "", SHA256, "manifest member digest invalid");
    const memberName = "candidate/" + path;
    assert.ok(headers.has(memberName), "manifest-listed file missing in ZIP");
    assert.equal(verified.get(memberName)?.bytes, file.bytes,
      "candidate file length mismatch");
    assert.equal(verified.get(memberName)?.sha256, file.sha256,
      "candidate file hash mismatch");
    names.add(memberName);
    previous = path;
    total += file.bytes;
    assert.ok(total <= 256 * 1024 * 1024,
      "candidate file sum exceeds expanded ZIP budget");
  }
  assert.equal(total, manifest.totalBytes, "manifest total bytes mismatch");
  assert.equal(names.size, manifest.fileCount + 2,
    "manifest paths duplicate or overlap");
  assert.equal(verified.size, names.size, "ZIP contains unlisted file");
  assert.ok([...verified.keys()].every(name => names.has(name)),
    "ZIP contains unknown candidate file");

  const { candidateSha256, ...core } = manifest;
  assert.equal(hash(Buffer.from(JSON.stringify(core), "utf8")), candidateSha256,
    "candidate manifest core hash mismatch");
  assert.equal(candidateSha256, expectedCandidateSha256,
    "candidate digest not independently pinned");

  assert.equal(receipt.schema, "dashboard-rpi5.native-candidate-receipt.v1");
  assert.equal(receipt.sourceSha, sourceSha);
  assert.equal(receipt.candidateSha256, candidateSha256);
  assert.equal(receipt.fileCount, manifest.fileCount);
  assert.equal(receipt.totalBytes, manifest.totalBytes);
  assert.equal(receipt.platform, "linux");
  assert.equal(receipt.architecture, "arm64");
  assert.equal(receipt.status, "UNTRUSTED_SOURCE_ONLY_NOT_DEPLOYED");
  assert.equal(receipt.activationAuthorized, false);
  const result = {
    status: "ZIP_MANIFEST_BYTES_CLOSED_NOT_AUTHORIZED_FOR_HOST",
    sourceSha, candidateSha256,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    liveMutation: false,
  };
  if (includeValidatedMetadata === true) {
    // Internal bridge for the source-only provenance correlator.
    // These values are derived from verified ZIP bytes, not caller projections.
    result.validatedMetadata = {
      manifest, receipt,
      entries: envelope.entries.map(({ name, kind, bytes }) => ({ name, kind, bytes })),
    };
  }
  return result;
}
