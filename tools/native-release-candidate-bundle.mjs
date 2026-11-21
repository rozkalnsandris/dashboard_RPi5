import assert from "node:assert/strict";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  createProductionCandidateManifest,
  verifyProductionCandidateManifest,
  verifyInstalledProductionCandidateManifest,
} from "./production-candidate-manifest.mjs";
import {
  loadNativeReleaseEvidence,
  validateNativeReleaseEvidence,
} from "./native-release-profile.mjs";

const FULL_SHA = /^[a-f0-9]{40}$/u;

export function validateNativeBundleTarget({
  rootDir, outputDir, sourceSha, platform = process.platform, arch = process.arch,
}) {
  assert.equal(platform, "linux", "candidate requires Linux");
  assert.equal(arch, "arm64", "candidate requires ARM64");
  assert.match(sourceSha ?? "", FULL_SHA, "candidate requires exact 40-hex SHA");
  assert.ok(typeof rootDir === "string" && rootDir !== "", "checkout root required");
  assert.ok(typeof outputDir === "string" && isAbsolute(outputDir),
    "output must be an absolute path");
  const root = resolve(rootDir);
  const output = resolve(outputDir);
  assert.ok(root !== output && !output.startsWith(root + sep) && !root.startsWith(output + sep),
    "output must be outside and not enclose checkout");
  return { root, output, sourceSha };
}

function safeSegments(path) {
  assert.ok(typeof path === "string" && path !== "" && !isAbsolute(path)
    && !path.includes("\\") && !path.includes("\0"), "invalid candidate file path");
  const segments = path.split("/");
  assert.ok(segments.every((s) => s !== "" && s !== "." && s !== ".."),
    "manifest path not normalized");
  return segments;
}

export async function stageNativeReleaseBundle(input) {
  const { root, output, sourceSha } = validateNativeBundleTarget(input);
  const statRoot = await lstat(root);
  assert.ok(statRoot.isDirectory() && !statRoot.isSymbolicLink(), "checkout root not real");
  assert.equal(
    validateNativeReleaseEvidence(await loadNativeReleaseEvidence(root)).status,
    "SOURCE_ONLY_PROFILE_VALID",
  );
  const manifest = await createProductionCandidateManifest({ rootDir: root, sourceSha });
  await verifyProductionCandidateManifest({ rootDir: root, sourceSha, manifest });

  // Exclusive staging: do not overwrite, retry, or silently clean up.
  await mkdir(output);
  const candidate = resolve(output, "candidate");
  await mkdir(candidate);
  for (const entry of manifest.files) {
    const segments = safeSegments(entry.path);
    let parent = root;
    for (const segment of segments.slice(0, -1)) {
      parent = resolve(parent, segment);
      const st = await lstat(parent);
      assert.ok(st.isDirectory() && !st.isSymbolicLink(),
        "manifest source directory must be real");
    }
    const source = resolve(root, ...segments);
    const destination = resolve(candidate, ...segments);
    assert.equal(relative(candidate, destination), entry.path, "candidate escaped output");
    const st = await lstat(source);
    assert.ok(st.isFile() && !st.isSymbolicLink(),
      "manifest source must be a regular file");
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  }

  await verifyInstalledProductionCandidateManifest({
    rootDir: candidate, sourceSha, manifest,
  });
  const receipt = {
    schema: "dashboard-rpi5.native-candidate-receipt.v1",
    sourceSha,
    candidateSha256: manifest.candidateSha256,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    platform: "linux",
    architecture: "arm64",
    status: "UNTRUSTED_SOURCE_ONLY_NOT_DEPLOYED",
    activationAuthorized: false,
  };
  await writeFile(resolve(output, "candidate-manifest.json"),
    JSON.stringify(manifest) + "\n", { flag: "wx" });
  const receiptPath = resolve(output, "candidate-receipt.json");
  await writeFile(receiptPath, JSON.stringify(receipt) + "\n", { flag: "wx" });
  assert.deepStrictEqual(JSON.parse(await readFile(receiptPath, "utf8")), receipt);
  return receipt;
}

function parseArgs(argv) {
  if (argv.length !== 6) throw new Error("required: --root --sha --output");
  const allowed = new Set(["--root", "--sha", "--output"]);
  const parsed = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    if (!allowed.has(argv[i]) || parsed.has(argv[i]) || argv[i + 1] === undefined) {
      throw new Error("unexpected or duplicate candidate argument");
    }
    parsed.set(argv[i], argv[i + 1]);
  }
  if (parsed.size !== 3) throw new Error("candidate arguments missing");
  return {
    rootDir: parsed.get("--root"),
    sourceSha: parsed.get("--sha"),
    outputDir: parsed.get("--output"),
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.stdout.write(JSON.stringify(
      await stageNativeReleaseBundle(parseArgs(process.argv.slice(2))),
    ) + "\n");
  } catch (error) {
    process.stderr.write("NATIVE_CANDIDATE_FAIL_CLOSED: " + error.message + "\n");
    process.exitCode = 1;
  }
}
