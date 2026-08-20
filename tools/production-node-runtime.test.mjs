import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertProductionNodeRuntime } from "./production-node-runtime.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(await readFile(resolve(ROOT, "ops/production/host-readiness-contract.json"), "utf8"));
const BASE = Object.freeze({
  platform: "linux",
  arch: "arm64",
  nodeVersion: "24.19.0",
  execPath: "/usr/bin/node",
  contract,
});

test("production Node runtime accepts the reviewed v24 runtime at or above 24.2", () => {
  const result = assertProductionNodeRuntime(BASE);
  assert.equal(result.status, "PASS");
  assert.equal(result.nodeMinimum, "24.2.0");
  assert.equal(result.mutationAllowed, false);
  assert.equal(assertProductionNodeRuntime({ ...BASE, nodeVersion: "24.2.0" }).status, "PASS");
});

test("Node 24.0 and 24.1 fail before production host readiness", () => {
  for (const nodeVersion of ["24.0.0", "24.1.9"]) {
    assert.throws(
      () => assertProductionNodeRuntime({ ...BASE, nodeVersion }),
      /below reviewed minimum 24\.2\.0/u,
    );
  }
});

test("wrong Node major, architecture and executable path fail closed", () => {
  assert.throws(() => assertProductionNodeRuntime({ ...BASE, nodeVersion: "25.0.0" }), /Node major mismatch/u);
  assert.throws(() => assertProductionNodeRuntime({ ...BASE, arch: "x64" }), /architecture mismatch/u);
  assert.throws(() => assertProductionNodeRuntime({ ...BASE, execPath: "/usr/local/bin/node" }), /executable path mismatch/u);
});

test("runtime verifier avoids import.meta.main so it can reject Node 24.0/24.1", async () => {
  const source = await readFile(resolve(ROOT, "tools/production-node-runtime.mjs"), "utf8");
  assert.doesNotMatch(source, /import\.meta\.main/u);
  assert.match(source, /fileURLToPath\(import\.meta\.url\)/u);
  assert.doesNotMatch(source, /node:child_process|\bfetch\s*\(|systemctl|sudo|chmod|chown/iu);
});
