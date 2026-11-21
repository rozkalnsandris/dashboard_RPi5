import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";

import { verifyNativeArtifactCandidateClosure } from "./native-artifact-manifest-closure.mjs";
import { verifyNativeArtifactZipPayload } from "./native-artifact-zip-envelope.mjs";

const sourceSha = "a".repeat(40);
const hash = data => createHash("sha256").update(data).digest("hex");
const transportDigest = data => "sha256:" + hash(data);
const mode = (0o100644 << 16) >>> 0;

function zip(items) {
  const parts = [], central = [];
  let offset = 0;
  for (const item of items) {
    const name = Buffer.from(item.name);
    const plain = Buffer.isBuffer(item.bytes) ? item.bytes : Buffer.from(item.bytes);
    const body = deflateRawSync(plain);
    const crc = crc32(plain) >>> 0;
    const local = Buffer.alloc(30), descriptor = Buffer.alloc(16);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(name.length, 26);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(body.length, 8);
    descriptor.writeUInt32LE(plain.length, 12);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(0x0314, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(8, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(plain.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(mode, 38);
    record.writeUInt32LE(offset, 42);
    parts.push(local, name, body, descriptor);
    central.push(record, name);
    offset += local.length + name.length + body.length + descriptor.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

function fixture({
  files = [{ path: "apps/server/dist/index.js", body: "hello" }],
  zipFiles = files, extra = [], changeManifest, changeReceipt,
  manifestString, receiptString,
} = {}) {
  const fileRecords = files.map(file => ({
    path: file.path,
    bytes: Buffer.byteLength(file.body),
    sha256: hash(file.body),
  }));
  const core = {
    schema: "dashboard-rpi5.production-candidate.v1",
    sourceSha,
    releasePath: "/opt/dashboard_RPi5/releases/" + sourceSha,
    nodeMajor: 24,
    hashAlgorithm: "sha256",
    fileCount: fileRecords.length,
    totalBytes: fileRecords.reduce((sum, x) => sum + x.bytes, 0),
    files: fileRecords,
  };
  const digest = hash(JSON.stringify(core));
  const manifest = { ...core, candidateSha256: digest };
  const receipt = {
    schema: "dashboard-rpi5.native-candidate-receipt.v1",
    sourceSha, candidateSha256: digest,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    platform: "linux", architecture: "arm64",
    status: "UNTRUSTED_SOURCE_ONLY_NOT_DEPLOYED",
    activationAuthorized: false,
  };
  changeManifest?.(manifest);
  changeReceipt?.(receipt);
  const entries = [
    { name: "candidate-manifest.json",
      bytes: manifestString?.(manifest) ?? JSON.stringify(manifest) + "\n" },
    { name: "candidate-receipt.json",
      bytes: receiptString?.(receipt) ?? JSON.stringify(receipt) + "\n" },
    ...zipFiles.map(file => ({
      name: "candidate/" + file.path, bytes: file.body,
    })),
    ...extra.map(file => ({ name: "candidate/" + file.path, bytes: file.body })),
  ];
  return { archive: zip(entries), digest, manifest, receipt };
}

function verify(item) {
  return verifyNativeArtifactCandidateClosure({
    archive: item.archive, transportDigest: transportDigest(item.archive),
    sourceSha, expectedCandidateSha256: item.digest,
  });
}

test("signed GitHub ZIP byte hashes close exact manifest and untrusted receipt", () => {
  const sample = fixture();
  const result = verify(sample);
  assert.deepStrictEqual(result, {
    status: "ZIP_MANIFEST_BYTES_CLOSED_NOT_AUTHORIZED_FOR_HOST",
    sourceSha, candidateSha256: sample.digest, fileCount: 1,
    totalBytes: 5, liveMutation: false,
  });
});

test("existing ZIP payload verifier remains independently applicable", () => {
  const sample = fixture();
  assert.equal(verifyNativeArtifactZipPayload(
    sample.archive, transportDigest(sample.archive),
  ).entries.length, 3);
});

for (const [label, input] of [
  ["wrong source SHA", () => {
    const sample = fixture();
    return () => verifyNativeArtifactCandidateClosure({
      archive: sample.archive, transportDigest: transportDigest(sample.archive),
      sourceSha: "b".repeat(40), expectedCandidateSha256: sample.digest,
    });
  }],
  ["wrong independently selected candidate digest", () => {
    const sample = fixture();
    return () => verifyNativeArtifactCandidateClosure({
      archive: sample.archive, transportDigest: transportDigest(sample.archive),
      sourceSha, expectedCandidateSha256: "0".repeat(64),
    });
  }],
  ["duplicate manifest JSON key", () => () => verify(fixture({
    manifestString: manifest => JSON.stringify(manifest).replace(
      /}$/u, ',"sourceSha":"' + sourceSha + '"}',
    ) + "\n",
  }))],
  ["duplicate receipt JSON key", () => () => verify(fixture({
    receiptString: receipt => JSON.stringify(receipt).replace(
      /}$/u, ',"architecture":"arm64"}',
    ) + "\n",
  }))],
  ["noncanonical manifest whitespace", () => () => verify(fixture({
    manifestString: manifest => " " + JSON.stringify(manifest) + "\n",
  }))],
  ["unexpected manifest field", () => () => verify(fixture({
    changeManifest: manifest => { manifest.extra = true; },
  }))],
  ["unexpected receipt field", () => () => verify(fixture({
    changeReceipt: receipt => { receipt.extra = true; },
  }))],
  ["file hash drift despite valid ZIP CRC", () => () => verify(fixture({
    zipFiles: [{ path: "apps/server/dist/index.js", body: "world" }],
  }))],
  ["file length drift despite valid ZIP CRC", () => () => verify(fixture({
    zipFiles: [{ path: "apps/server/dist/index.js", body: "longer" }],
  }))],
  ["unlisted ZIP candidate file", () => () => verify(fixture({
    extra: [{ path: "extra.txt", body: "unexpected" }],
  }))],
  ["missing expected candidate file", () => () => verify(fixture({
    zipFiles: [{ path: "other.txt", body: "hello" }],
  }))],
  ["unsorted manifest files", () => () => verify(fixture({
    files: [{ path: "z.txt", body: "z" }, { path: "a.txt", body: "a" }],
  }))],
  ["reserved node_modules path", () => () => verify(fixture({
    files: [{ path: "node_modules/a.js", body: "hello" }],
  }))],
  ["manifest count drift", () => () => verify(fixture({
    changeManifest: manifest => { manifest.fileCount += 1; },
  }))],
  ["manifest total bytes drift", () => () => verify(fixture({
    changeManifest: manifest => { manifest.totalBytes += 1; },
  }))],
  ["invalid receipt architecture", () => () => verify(fixture({
    changeReceipt: receipt => { receipt.architecture = "amd64"; },
  }))],
  ["unsafe activated receipt", () => () => verify(fixture({
    changeReceipt: receipt => { receipt.activationAuthorized = true; },
  }))],
  ["invalid receipt status", () => () => verify(fixture({
    changeReceipt: receipt => { receipt.status = "DEPLOYED"; },
  }))],
  ["unexpected source drive letter path", () => () => verify(fixture({
    files: [{ path: "C:/temp/a", body: "hello" }],
  }))],
]) {
  test("fail closed: " + label, () => assert.throws(input()));
}
