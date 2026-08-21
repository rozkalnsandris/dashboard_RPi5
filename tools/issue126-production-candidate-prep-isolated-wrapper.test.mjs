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

test("R3 wrapper is pinned to the reviewed PR170 merge and helper blob", () => {
  assert.match(wrapper, /MAIN="db6c4383b33dd9902094c54afd60e51a161f8f4c"/u);
  assert.match(wrapper, /MAIN_TREE="1a457416331357c54e9dae278769a4ef3690bd7c"/u);
  assert.match(wrapper, /MAIN_PARENT="4fd40cd0cc639bad84463b9680e627f8e02157e2"/u);
  assert.match(wrapper, /PR170_HEAD="514a6405d2bbd66938e4a85eec722d172e2efd93"/u);
  assert.match(wrapper, /HELPER_BLOB="3541750f511289056c4a4b8d684db139b9c903eb"/u);
});

test("R3 wrapper preserves the historical candidate workspace and uses an isolated HOME", () => {
  assert.match(wrapper, /OLD_GLOBAL_WORKSPACE=/u);
  assert.match(wrapper, /OLD_GLOBAL_WORKSPACE_PRESERVED=/u);
  assert.match(wrapper, /ISOLATED_HOME="\$RUN_ROOT\/home"/u);
  assert.match(wrapper, /env HOME="\$ISOLATED_HOME" USER="andris" LOGNAME="andris" bash "\$HELPER"/u);
  assert.doesNotMatch(wrapper, /\brm\b/u);
  assert.doesNotMatch(wrapper, /\bmv\b/u);
});

test("R3 wrapper remains one-shot, Raspberry Pi 5-only, and fail-closed", () => {
  assert.match(wrapper, /Raspberry Pi 5 Model B/u);
  assert.match(wrapper, /one-shot run directory already exists/u);
  assert.match(wrapper, /AUTO_RETRY=NO AUTO_CLEANUP=NO PRODUCTION_MUTATION_AUTHORIZATION=NONE/u);
  assert.match(wrapper, /helper BLOCKED\/failed; preserve/u);
  assert.doesNotMatch(wrapper, /--apply/u);
  assert.doesNotMatch(wrapper, /systemctl\s+(restart|start|stop|enable|disable)/u);
});
