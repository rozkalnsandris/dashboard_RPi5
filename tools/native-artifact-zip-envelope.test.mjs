import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { deflateRawSync } from "node:zlib";
import { verifyNativeArtifactZipEnvelope } from "./native-artifact-zip-envelope.mjs";

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
    const body = method === 8 ? deflateRawSync(plain) : plain;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0x12345678, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x0314, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(0x12345678, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(plain.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(ordinary, 38);
    cd.writeUInt32LE(offset, 42);
    directory.push(cd, name);
    offset += local.length + name.length + body.length;
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
const check = b => verifyNativeArtifactZipEnvelope(b, digest(b));
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
