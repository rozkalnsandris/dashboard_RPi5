import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RootOwnedEvidenceFileError, readRootOwnedEvidenceJson } from "./evidence-file.js";

const directories: string[] = [];
const currentUid = process.getuid?.() ?? 0;

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-root-evidence-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("root-owned evidence file boundary", () => {
  it("reads a bounded non-writable regular JSON file", async () => {
    const directory = await makeDirectory();
    const path = join(directory, "evidence.json");
    await writeFile(path, '{"ok":true}\n', { mode: 0o644 });

    await expect(readRootOwnedEvidenceJson({ path, requiredUid: currentUid })).resolves.toEqual({ ok: true });
  });

  it("fails closed for symlink, writable, wrong-owner and oversized sources", async () => {
    const directory = await makeDirectory();
    const target = join(directory, "target.json");
    await writeFile(target, '{"ok":true}\n', { mode: 0o644 });

    const link = join(directory, "link.json");
    await symlink(target, link);
    await expect(readRootOwnedEvidenceJson({ path: link, requiredUid: currentUid })).rejects.toBeInstanceOf(RootOwnedEvidenceFileError);

    await chmod(target, 0o666);
    await expect(readRootOwnedEvidenceJson({ path: target, requiredUid: currentUid })).rejects.toBeInstanceOf(RootOwnedEvidenceFileError);
    await chmod(target, 0o644);

    await expect(readRootOwnedEvidenceJson({ path: target, requiredUid: currentUid + 1 })).rejects.toBeInstanceOf(RootOwnedEvidenceFileError);

    const oversized = join(directory, "oversized.json");
    await writeFile(oversized, JSON.stringify({ pad: "x".repeat(2_000) }), { mode: 0o644 });
    await expect(readRootOwnedEvidenceJson({ path: oversized, requiredUid: currentUid, maxBytes: 1_024 })).rejects.toBeInstanceOf(RootOwnedEvidenceFileError);
  });

  it("fails closed for malformed JSON and aborted reads", async () => {
    const directory = await makeDirectory();
    const malformed = join(directory, "bad.json");
    await writeFile(malformed, "not-json\n", { mode: 0o644 });
    await expect(readRootOwnedEvidenceJson({ path: malformed, requiredUid: currentUid })).rejects.toBeInstanceOf(RootOwnedEvidenceFileError);

    const valid = join(directory, "valid.json");
    await writeFile(valid, '{}\n', { mode: 0o644 });
    const controller = new AbortController();
    controller.abort();
    await expect(readRootOwnedEvidenceJson({ path: valid, requiredUid: currentUid }, controller.signal)).rejects.toBeInstanceOf(RootOwnedEvidenceFileError);
  });
});
