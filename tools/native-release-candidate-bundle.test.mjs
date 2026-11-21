import assert from "node:assert/strict";
import test from "node:test";
import { validateNativeBundleTarget } from "./native-release-candidate-bundle.mjs";

const value = {
  rootDir: "/work/dashboard",
  outputDir: "/tmp/dashboard-native",
  sourceSha: "a".repeat(40),
  platform: "linux",
  arch: "arm64",
};

test("accept exact Linux ARM64 SHA outside checkout", () => {
  assert.deepStrictEqual(validateNativeBundleTarget(value), {
    root: value.rootDir, output: value.outputDir, sourceSha: value.sourceSha,
  });
});
for (const [label, change] of [
  ["wrong CPU architecture", { arch: "x64" }],
  ["wrong OS", { platform: "darwin" }],
  ["mutable source ref", { sourceSha: "main" }],
  ["short SHA", { sourceSha: "a".repeat(39) }],
  ["upper-case SHA", { sourceSha: "A".repeat(40) }],
  ["empty checkout", { rootDir: "" }],
  ["relative output", { outputDir: "./release" }],
  ["empty output", { outputDir: "" }],
  ["output is checkout", { outputDir: "/work/dashboard" }],
  ["output inside checkout", { outputDir: "/work/dashboard/dist" }],
  ["output enclosing checkout", { outputDir: "/work" }],
]) {
  test("fail closed: " + label, () => {
    assert.throws(() => validateNativeBundleTarget({ ...value, ...change }));
  });
}
