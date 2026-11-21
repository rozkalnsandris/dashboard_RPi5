import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";

// Source-only ZIP header admission. No download, decompression, extraction, host access or mutations.
const LIMITS = Object.freeze({ archive: 64 * 1024 * 1024, expanded: 256 * 1024 * 1024, one: 64 * 1024 * 1024, count: 8192, manifest: 4 * 1024 * 1024, receipt: 64 * 1024 });
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const HEX_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const safe = (bytes, at, length, label) => {
  assert.ok(Number.isSafeInteger(at) && Number.isSafeInteger(length) && at >= 0 &&
    length >= 0 && at + length <= bytes.length, `ZIP ${label} out of bounds`);
};
const u16 = (bytes, at) => { safe(bytes, at, 2, "16-bit header"); return bytes.readUInt16LE(at); };
const u32 = (bytes, at) => { safe(bytes, at, 4, "32-bit header"); return bytes.readUInt32LE(at); };

function canonicalName(bytes) {
  assert.ok(bytes.length > 0 && bytes.length <= 1024, "ZIP member name length");
  const name = [...bytes].some(b => b > 0x7f) ? UTF8.decode(bytes) : bytes.toString("ascii");
  assert.ok(!name.includes("\\") && !name.includes("\u0000") &&
    !name.startsWith("/") && name.normalize("NFC") === name, "ZIP member path unsafe");
  const segments = name.split("/");
  assert.ok(segments.every(x => x && x !== "." && x !== "..") &&
    !/^[A-Za-z]:/u.test(segments[0]), "ZIP member path not canonical");
  assert.ok(name === "candidate-manifest.json" || name === "candidate-receipt.json" ||
    (name.startsWith("candidate/") && name !== "candidate/"), "ZIP member not in candidate envelope");
  return name;
}

export function verifyNativeArtifactZipEnvelope(archive, expectedTransportDigest) {
  assert.ok(Buffer.isBuffer(archive) && archive.length >= 22 &&
    archive.length <= LIMITS.archive, "ZIP archive must be a bounded Buffer");
  assert.match(expectedTransportDigest ?? "", HEX_DIGEST, "expected ZIP transport SHA-256 required");
  const actual = "sha256:" + createHash("sha256").update(archive).digest("hex");
  assert.equal(actual, expectedTransportDigest, "ZIP transport digest mismatch");

  const end = archive.length - 22;
  assert.equal(u32(archive, end), SIG_END, "ZIP exact end-of-central-directory required");
  assert.equal(u16(archive, end + 4), 0, "multi-disk ZIP unsupported");
  assert.equal(u16(archive, end + 6), 0, "central directory disk unsupported");
  const diskEntries = u16(archive, end + 8);
  const totalEntries = u16(archive, end + 10);
  assert.ok(totalEntries > 0 && totalEntries <= LIMITS.count &&
    totalEntries !== 0xffff && diskEntries === totalEntries, "ZIP member count invalid");
  const centralLength = u32(archive, end + 12);
  const centralStart = u32(archive, end + 16);
  assert.equal(u16(archive, end + 20), 0, "ZIP archive comments unsupported");
  assert.ok(centralLength !== 0xffffffff && centralStart !== 0xffffffff &&
    centralStart + centralLength === end, "ZIP central bounds invalid");
  safe(archive, centralStart, centralLength, "central directory");

  const local = [];
  const members = [];
  const names = new Set();
  let pos = centralStart;
  let expanded = 0;
  for (let i = 0; i < totalEntries; i += 1) {
    safe(archive, pos, 46, "central member");
    assert.equal(u32(archive, pos), SIG_CENTRAL, "ZIP central header invalid");
    const madeBy = u16(archive, pos + 4);
    const needed = u16(archive, pos + 6);
    const flags = u16(archive, pos + 8);
    const method = u16(archive, pos + 10);
    const crc = u32(archive, pos + 16);
    const compressed = u32(archive, pos + 20);
    const size = u32(archive, pos + 24);
    const nameLength = u16(archive, pos + 28);
    const extra = u16(archive, pos + 30);
    const comment = u16(archive, pos + 32);
    const startDisk = u16(archive, pos + 34);
    const external = u32(archive, pos + 38);
    const offset = u32(archive, pos + 42);
    assert.ok(needed <= 20 && (flags === 0 || flags === 0x0800) &&
      (method === 0 || method === 8), "ZIP unsupported version/flags/compression");
    assert.ok(extra === 0 && comment === 0 && startDisk === 0,
      "ZIP extra/metadata/multi-disk unsupported");
    assert.ok(offset !== 0xffffffff && compressed !== 0xffffffff &&
      size !== 0xffffffff, "ZIP64 unsupported");
    const os = madeBy >>> 8;
    const fileMode = external >>> 16;
    assert.ok(os === 3 && (fileMode & 0o170000) === 0o100000 &&
      (fileMode & 0o7000) === 0, "ZIP entry is not an ordinary Unix file");
    assert.ok(size <= LIMITS.one && compressed <= LIMITS.archive &&
      (method !== 0 || size === compressed), "ZIP member size/compression invalid");
    safe(archive, pos + 46, nameLength, "central filename");
    const nameBytes = archive.subarray(pos + 46, pos + 46 + nameLength);
    if ((flags & 0x0800) === 0) {
      assert.ok([...nameBytes].every(x => x < 128),
        "ZIP UTF-8 flag required for non-ASCII names");
    }
    const name = canonicalName(nameBytes);
    assert.ok(!names.has(name), "ZIP duplicate member");
    names.add(name);
    if (name === "candidate-manifest.json") {
      assert.ok(size > 0 && size <= LIMITS.manifest, "ZIP manifest oversized");
    }
    if (name === "candidate-receipt.json") {
      assert.ok(size > 0 && size <= LIMITS.receipt, "ZIP receipt oversized");
    }
    expanded += size;
    assert.ok(expanded <= LIMITS.expanded, "ZIP expanded size budget exceeded");
    assert.ok(offset < centralStart, "ZIP local header out of range");
    local.push({ offset, flags, method, crc, compressed, size, nameBytes });
    members.push({ name, kind: "regular-file", bytes: size });
    pos += 46 + nameLength;
  }
  assert.equal(pos, end, "ZIP central directory has undeclared bytes");
  assert.ok(names.has("candidate-manifest.json") &&
    names.has("candidate-receipt.json"), "ZIP required receipts missing");
  assert.ok(members.some(x => x.name.startsWith("candidate/")),
    "ZIP candidate files missing");

  local.sort((a, b) => a.offset - b.offset);
  let next = 0;
  for (const entry of local) {
    assert.equal(entry.offset, next, "ZIP local segments overlap or leave gaps");
    safe(archive, next, 30, "local header");
    assert.equal(u32(archive, next), SIG_LOCAL, "ZIP local header invalid");
    assert.ok(u16(archive, next + 4) <= 20, "ZIP local version unsupported");
    assert.equal(u16(archive, next + 6), entry.flags, "ZIP local flags mismatch");
    assert.equal(u16(archive, next + 8), entry.method, "ZIP local method mismatch");
    assert.equal(u32(archive, next + 14), entry.crc, "ZIP local CRC header mismatch");
    assert.equal(u32(archive, next + 18), entry.compressed,
      "ZIP local compressed size mismatch");
    assert.equal(u32(archive, next + 22), entry.size,
      "ZIP local uncompressed size mismatch");
    const n = u16(archive, next + 26);
    assert.equal(n, entry.nameBytes.length, "ZIP local filename length mismatch");
    assert.equal(u16(archive, next + 28), 0, "ZIP local extra fields unsupported");
    const data = next + 30 + n;
    safe(archive, next + 30, n, "local filename");
    assert.ok(archive.subarray(next + 30, data).equals(entry.nameBytes),
      "ZIP local/central filename mismatch");
    safe(archive, data, entry.compressed, "compressed payload");
    next = data + entry.compressed;
  }
  assert.equal(next, centralStart, "ZIP local payload has trailing or missing bytes");

  return {
    status: "ZIP_ENVELOPE_ONLY_NO_PAYLOAD_VERIFICATION",
    transportSha256: actual,
    count: totalEntries,
    expandedBytes: expanded,
    entries: members,
    liveMutation: false,
  };
}
