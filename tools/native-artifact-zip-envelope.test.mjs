import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { crc32, deflateRawSync } from "node:zlib";
import {
  verifyNativeArtifactZipEnvelope,
  verifyNativeArtifactZipPayload,
} from "./native-artifact-zip-envelope.mjs";

const digest = b => "sha256:" + createHash("sha256").update(b).digest("hex");
const ordinary = (0o100644 << 16) >>> 0;
function makeZip(files = [
  { name: "candidate-manifest.json", data: "{}" },
  { name: "candidate-receipt.json", data: "{}" },
  { name: "candidate/apps/server/dist/index.js", data: "hello", method: 8 },
]) {
  const chunks = [], directory = [];
  let offset = 0;
  for (const item of files) {
    const name = Buffer.from(item.name, "utf8");
    const plain = Buffer.from(item.data);
    const method = item.method ?? 0;
    const rawBody = method === 8 ? deflateRawSync(plain) : plain;
    const body = item.trailingBytes ? Buffer.concat([rawBody, Buffer.from(item.trailingBytes)]) : rawBody;
    const reportedSize = item.reportedSize ?? plain.length;
    const reportedCrc = item.validCrc ? crc32(plain) : 0x12345678;
    const signedDescriptor = item.signedDescriptor === true;
    const descriptor = signedDescriptor ? Buffer.alloc(16) : Buffer.alloc(0);
    if (signedDescriptor) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(reportedCrc, 4);
      descriptor.writeUInt32LE(body.length, 8);
      descriptor.writeUInt32LE(reportedSize, 12);
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(signedDescriptor ? 8 : 0, 6);
    local.writeUInt16LE(method, 8);
    if (!signedDescriptor) {
      local.writeUInt32LE(reportedCrc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(reportedSize, 22);
    }
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, body, descriptor);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x0314, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(signedDescriptor ? 8 : 0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(reportedCrc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(reportedSize, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(ordinary, 38);
    cd.writeUInt32LE(offset, 42);
    directory.push(cd, name);
    offset += local.length + name.length + body.length + descriptor.length;
  }
  const cdBytes = Buffer.concat(directory);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBytes, eocd]);
}
const testArchive = makeZip();
const signedDescriptorArchive = makeZip([
  { name: "candidate-manifest.json", data: "{}", method: 8, signedDescriptor: true },
  { name: "candidate-receipt.json", data: "{}", method: 8, signedDescriptor: true },
  { name: "candidate/apps/server/dist/index.js", data: "hello", method: 8, signedDescriptor: true },
]);
const check = b => verifyNativeArtifactZipEnvelope(b, digest(b));
const signedOffset = b => 30 + b.readUInt16LE(26) +
  b.readUInt32LE(b.readUInt32LE(b.length - 22 + 16) + 20);
test("bounded exact ZIP envelope accepts regular-file-only candidate structure", () => {
  const r = check(testArchive);
  assert.equal(r.status, "ZIP_ENVELOPE_ONLY_NO_PAYLOAD_VERIFICATION");
  assert.equal(r.count, 3);
  assert.equal(r.liveMutation, false);
  assert.deepStrictEqual(r.entries.map(x => x.name), [
    "candidate-manifest.json", "candidate-receipt.json",
    "candidate/apps/server/dist/index.js",
  ]);
});
test("accept exact GitHub upload-artifact signed 16-byte data descriptors", () => {
  const result = check(signedDescriptorArchive);
  assert.equal(result.status, "ZIP_ENVELOPE_ONLY_NO_PAYLOAD_VERIFICATION");
  assert.equal(result.count, 3);
  assert.equal(result.expandedBytes, 9);
});

for (const [label, write] of [
  ["missing descriptor signature", b => b.writeUInt32LE(0, signedOffset(b))],
  ["descriptor CRC mismatch", b => b.writeUInt32LE(0, signedOffset(b) + 4)],
  ["descriptor compressed size mismatch", b => b.writeUInt32LE(0, signedOffset(b) + 8)],
  ["descriptor uncompressed size mismatch", b => b.writeUInt32LE(0, signedOffset(b) + 12)],
  ["nonzero local CRC with descriptor", b => b.writeUInt32LE(1, 14)],
  ["nonzero local compressed size with descriptor", b => b.writeUInt32LE(1, 18)],
  ["nonzero local plain size with descriptor", b => b.writeUInt32LE(1, 22)],
  ["missing local data descriptor flag", b => b.writeUInt16LE(0, 6)],
  ["unsupported encrypted descriptor flag", b => b.writeUInt16LE(9, 6)],
]) {
  test("reject " + label, () => {
    const bytes = Buffer.from(signedDescriptorArchive);
    write(bytes);
    assert.throws(() => check(bytes));
  });
}
function tamper(modify) {
  const b = Buffer.from(testArchive);
  modify(b);
  return b;
}
const endOffset = b => b.length - 22;
const central = b => b.readUInt32LE(endOffset(b) + 16);
for (const [name, make] of [
  ["invalid archive", () => Buffer.alloc(22)],
  ["appended data", () => Buffer.concat([testArchive, Buffer.alloc(1)])],
  ["local signature drift", () => tamper(b => b.writeUInt32LE(0, 0))],
  ["central signature drift", () => tamper(b => b.writeUInt32LE(0, central(b)))],
  ["ZIP comment", () => tamper(b => b.writeUInt16LE(1, endOffset(b) + 20))],
  ["multidisk entry", () => tamper(b => b.writeUInt16LE(1, endOffset(b) + 4))],
  ["ZIP64 entry count", () => tamper(b => b.writeUInt16LE(0xffff, endOffset(b) + 10))],
  ["ZIP64 central offset", () => tamper(b => b.writeUInt32LE(0xffffffff, endOffset(b) + 16))],
  ["central extra metadata", () => tamper(b => b.writeUInt16LE(1, central(b) + 30))],
  ["central encrypted flag", () => tamper(b => b.writeUInt16LE(1, central(b) + 8))],
  ["central data descriptor", () => tamper(b => b.writeUInt16LE(8, central(b) + 8))],
  ["central unsupported compression", () => tamper(b => b.writeUInt16LE(12, central(b) + 10))],
  ["central symlink", () => tamper(b => b.writeUInt32LE((0o120777 << 16) >>> 0, central(b) + 38))],
  ["central directory", () => tamper(b => b.writeUInt32LE((0o040755 << 16) >>> 0, central(b) + 38))],
  ["local CRC discrepancy", () => tamper(b => b.writeUInt32LE(0, 14))],
  ["local size discrepancy", () => tamper(b => b.writeUInt32LE(0, 18))],
  ["local flags discrepancy", () => tamper(b => b.writeUInt16LE(0x800, 6))],
  ["local filename discrepancy", () => tamper(b => b.write("X", 30, "utf8"))],
  ["central local offset points into data", () => tamper(b => b.writeUInt32LE(4, central(b) + 42))],
  ["unknown leading prefix", () => makeZip([
    { name: "hello.txt", data: "h" },
    { name: "candidate-manifest.json", data: "{}" },
    { name: "candidate-receipt.json", data: "{}" },
  ])],
  ["traversal name", () => makeZip([
    { name: "candidate/../evil", data: "hi" },
    { name: "candidate-manifest.json", data: "{}" },
    { name: "candidate-receipt.json", data: "{}" },
  ])],
  ["absolute name", () => makeZip([
    { name: "/etc/shadow", data: "hi" },
    { name: "candidate-manifest.json", data: "{}" },
    { name: "candidate-receipt.json", data: "{}" },
  ])],
  ["backslash name", () => makeZip([
    { name: "candidate\\a", data: "hi" },
    { name: "candidate-manifest.json", data: "{}" },
    { name: "candidate-receipt.json", data: "{}" },
  ])],
  ["duplicate name", () => makeZip([
    { name: "candidate-manifest.json", data: "{}" },
    { name: "candidate-manifest.json", data: "{}" },
    { name: "candidate-receipt.json", data: "{}" },
  ])],
  ["missing receipt", () => makeZip([
    { name: "candidate-manifest.json", data: "{}" },
    { name: "candidate/foo", data: "abc" },
  ])],
]) test("reject " + name, () => assert.throws(() => check(make())));
test("reject digest not matching archive", () => assert.throws(() =>
  verifyNativeArtifactZipEnvelope(testArchive, "sha256:" + "0".repeat(64))));
test("reject non-Buffer input", () => assert.throws(() =>
  check(new Uint8Array(testArchive))));
test("reject archive beyond budget", () => assert.throws(() =>
  check(Buffer.alloc(64 * 1024 * 1024 + 1))));

const integrityFiles = [
  { name: "candidate-manifest.json", data: "{}", method: 8,
    signedDescriptor: true, validCrc: true },
  { name: "candidate-receipt.json", data: "{}", method: 0, validCrc: true },
  { name: "candidate/apps/server/dist/index.js", data: "hello", method: 8,
    signedDescriptor: true, validCrc: true },
  { name: "candidate/empty.txt", data: "", method: 8,
    signedDescriptor: true, validCrc: true },
];

test("known CRC32 vector", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("ZIP byte integrity verifies stored/deflate/signed-descriptor/empty members", () => {
  const archive = makeZip(integrityFiles);
  const result = verifyNativeArtifactZipPayload(archive, digest(archive));
  assert.equal(result.status, "ZIP_PAYLOAD_BYTES_VERIFIED_NOT_RELEASE_VALIDATED");
  assert.equal(result.liveMutation, false);
  assert.equal(result.entries.length, 4);
  assert.deepStrictEqual(result.entries.map(x => x.name),
    integrityFiles.map(x => x.name));
  assert.equal(result.entries[2].bytes, 5);
  assert.equal(result.entries[2].sha256,
    createHash("sha256").update("hello").digest("hex"));
  assert.equal(result.entries[3].bytes, 0);
  assert.equal(result.entries[3].sha256,
    createHash("sha256").update("").digest("hex"));
});

test("reject ZIP payload CRC mismatch despite intact ZIP envelope", () => {
  const archive = makeZip(integrityFiles.map((entry, index) =>
    index === 2 ? { ...entry, validCrc: false } : entry));
  assert.equal(verifyNativeArtifactZipEnvelope(archive, digest(archive)).count, 4);
  assert.throws(() => verifyNativeArtifactZipPayload(archive, digest(archive)),
    /CRC32 mismatch/u);
});

test("reject ZIP payload expanded beyond declared file size while inflating", () => {
  const archive = makeZip(integrityFiles.map((entry, index) =>
    index === 2 ? { ...entry, reportedSize: 1 } : entry));
  assert.equal(verifyNativeArtifactZipEnvelope(archive, digest(archive)).count, 4);
  assert.throws(() => verifyNativeArtifactZipPayload(archive, digest(archive)));
});

test("reject valid deflate stream with trailing compressed bytes", () => {
  const archive = makeZip(integrityFiles.map((entry, index) =>
    index === 2 ? { ...entry, trailingBytes: [0xaa, 0xbb, 0xcc] } : entry));
  assert.equal(verifyNativeArtifactZipEnvelope(archive, digest(archive)).count, 4);
  assert.throws(() => verifyNativeArtifactZipPayload(archive, digest(archive)),
    /not fully consumed/u);
});

test("reject altered compressed data even if transport SHA is recomputed", () => {
  const archive = makeZip(integrityFiles);
  const dataStart = 30 + archive.readUInt16LE(26);
  archive[dataStart] ^= 0xff;
  assert.equal(verifyNativeArtifactZipEnvelope(archive, digest(archive)).count, 4);
  assert.throws(() => verifyNativeArtifactZipPayload(archive, digest(archive)));
});

test("reject ZIP payload integrity when supplied digest is wrong", () => {
  const archive = makeZip(integrityFiles);
  assert.throws(() => verifyNativeArtifactZipPayload(
    archive, "sha256:" + "0".repeat(64),
  ), /transport digest mismatch/u);
});
