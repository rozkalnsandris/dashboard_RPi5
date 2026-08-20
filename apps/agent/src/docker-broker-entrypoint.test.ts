import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { isDirectCliInvocation } from "./cli-entry.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});

describe("shared agent CLI entrypoint detection", () => {
  it("accepts the systemd current-symlink path for the real release module", async () => {
    const root = await mkdtemp(join(tmpdir(), "dashboard-rpi5-cli-entry-"));
    temporaryRoots.push(root);

    const release = join(root, "releases", "target");
    await mkdir(release, { recursive: true });
    const modulePath = join(release, "entry.js");
    await writeFile(modulePath, "// fixture\n", "utf8");

    const current = join(root, "current");
    await symlink(release, current, "dir");
    const invokedPath = join(current, "entry.js");

    expect(isDirectCliInvocation(invokedPath, pathToFileURL(modulePath).href)).toBe(true);
  });

  it("rejects imports, unrelated executables and missing paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "dashboard-rpi5-cli-entry-"));
    temporaryRoots.push(root);

    const modulePath = join(root, "entry.js");
    const otherPath = join(root, "other.js");
    await writeFile(modulePath, "// fixture\n", "utf8");
    await writeFile(otherPath, "// fixture\n", "utf8");

    const moduleUrl = pathToFileURL(modulePath).href;
    expect(isDirectCliInvocation(undefined, moduleUrl)).toBe(false);
    expect(isDirectCliInvocation(otherPath, moduleUrl)).toBe(false);
    expect(isDirectCliInvocation(join(root, "missing.js"), moduleUrl)).toBe(false);
  });
});
