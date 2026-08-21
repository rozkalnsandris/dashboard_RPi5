import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const wrapperPath = new URL("./operator/issue126-production-candidate-prep-isolated-wrapper.sh", import.meta.url);
const wrapper = readFileSync(wrapperPath, "utf8");

test("R3 wrapper is valid Bash", () => {
  const result = spawnSync("bash", ["-n", wrapperPath.pathname], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("R3 wrapper treats PR170 merge as immutable base/helper source, not live main", () => {
  assert.match(wrapper, /BASE_MAIN="db6c4383b33dd9902094c54afd60e51a161f8f4c"/u);
  assert.match(wrapper, /BASE_TREE="1a457416331357c54e9dae278769a4ef3690bd7c"/u);
  assert.match(wrapper, /WRAPPER_PR="172"/u);
  assert.match(wrapper, /HELPER_SOURCE="\$BASE_MAIN"/u);
  assert.match(wrapper, /HELPER_BLOB="3541750f511289056c4a4b8d684db139b9c903eb"/u);
  assert.doesNotMatch(wrapper, /^MAIN=/mu);
});

test("R3 post-merge gate accepts only the exact PR172 squash descendant", () => {
  assert.match(wrapper, /PR172 not merged/u);
  assert.match(wrapper, /PR172 base drift/u);
  assert.match(wrapper, /live main is not PR172 squash merge/u);
  assert.match(wrapper, /PR172 merge parent drift/u);
  assert.match(wrapper, /PR172 compare must be exactly one squash commit/u);
  assert.match(wrapper, /PR172 changed-file boundary drift/u);
  assert.match(wrapper, /PR172 exact-head CI not successful/u);
  assert.match(wrapper, /terminal-native \(x64\)/u);
  assert.match(wrapper, /terminal-native \(arm64\)/u);
});

test("R3 wrapper preserves the historical candidate workspace and uses an isolated HOME", () => {
  assert.match(wrapper, /OLD_GLOBAL_WORKSPACE=/u);
  assert.match(wrapper, /OLD_GLOBAL_WORKSPACE_PRESERVED=/u);
  assert.match(wrapper, /RUN_ROOT="\$ORIGINAL_HOME\/\.cache\/dashboard-rpi5-operator\/issue126-\$\{main_sha\}-r3"/u);
  assert.match(wrapper, /ISOLATED_HOME="\$RUN_ROOT\/home"/u);
  assert.match(wrapper, /env HOME="\$ISOLATED_HOME" USER="andris" LOGNAME="andris" bash "\$HELPER"/u);
  assert.doesNotMatch(wrapper, /\brm\b/u);
  assert.doesNotMatch(wrapper, /\bmv\b/u);
});

test("R3 wrapper remains Raspberry Pi 5-only and fail-closed", () => {
  assert.match(wrapper, /Raspberry Pi 5 Model B/u);
  assert.match(wrapper, /one-shot run directory already exists/u);
  assert.match(wrapper, /AUTO_RETRY=NO AUTO_CLEANUP=NO PRODUCTION_MUTATION_AUTHORIZATION=NONE/u);
  assert.match(wrapper, /helper BLOCKED\/failed; preserve/u);
  assert.doesNotMatch(wrapper, /--apply/u);
  assert.doesNotMatch(wrapper, /systemctl\s+(restart|start|stop|enable|disable)/u);
});
