import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { URL } from "node:url";
import test from "node:test";

const wrapperPath = new URL("./operator/issue126-production-candidate-prep-isolated-wrapper.sh", import.meta.url);
const wrapper = readFileSync(wrapperPath, "utf8");

test("R3 wrapper is valid Bash", () => {
  const result = spawnSync("bash", ["-n", wrapperPath.pathname], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("R3 pins PR170 as immutable historical helper source and PR172 as the live successor", () => {
  assert.match(wrapper, /BASE_MAIN="db6c4383b33dd9902094c54afd60e51a161f8f4c"/u);
  assert.match(wrapper, /BASE_TREE="1a457416331357c54e9dae278769a4ef3690bd7c"/u);
  assert.match(wrapper, /WRAPPER_PR="172"/u);
  assert.match(wrapper, /HELPER_SOURCE="\$BASE_MAIN"/u);
  assert.match(wrapper, /HELPER_BLOB="3541750f511289056c4a4b8d684db139b9c903eb"/u);
  assert.match(wrapper, /PR172 source is not merged/u);
  assert.match(wrapper, /live main is not PR172 squash merge/u);
});

test("R3 post-merge gate requires one verified squash successor and exact-head natural CI", () => {
  assert.match(wrapper, /PR172 merge must have exactly one parent/u);
  assert.match(wrapper, /PR172 merge parent drift/u);
  assert.match(wrapper, /PR172 compare must be exactly one squash commit/u);
  assert.match(wrapper, /PR172 compare total_commits drift/u);
  assert.match(wrapper, /PR172 changed-file boundary drift/u);
  assert.match(wrapper, /PR172 exact-head CI not successful/u);
  assert.match(wrapper, /head_sha=\$wrapper_head&event=pull_request/u);
  for (const job of ["check", "terminal-native (x64)", "terminal-native (arm64)"]) {
    assert.match(wrapper, new RegExp(job.replace(/[()]/gu, "\\$&"), "u"));
  }
});

test("R3 preserves the historical workspace and builds under one-shot isolated HOME", () => {
  assert.match(wrapper, /OLD_GLOBAL_WORKSPACE=/u);
  assert.match(wrapper, /OLD_GLOBAL_WORKSPACE_PRESERVED=/u);
  assert.match(wrapper, /old_workspace_fingerprint/u);
  assert.match(wrapper, /RUN_ROOT="\$ORIGINAL_HOME\/\.cache\/dashboard-rpi5-operator\/issue126-\$\{main_sha\}-r3"/u);
  assert.match(wrapper, /ISOLATED_HOME="\$RUN_ROOT\/home"/u);
  assert.match(wrapper, /env HOME="\$ISOLATED_HOME" USER="andris" LOGNAME="andris" bash "\$PATCHED_HELPER"/u);
  assert.doesNotMatch(wrapper, /\brm\b/u);
  assert.doesNotMatch(wrapper, /\bmv\b/u);
});

test("R3 deterministic transform fixes the post-PR172 lineage trap", () => {
  assert.match(wrapper, /REBIND_MERGE/u);
  assert.match(wrapper, /live_main_sha=/u);
  assert.match(wrapper, /main_sha=\\"\$REBIND_MERGE\\"/u);
  assert.match(wrapper, /historical-main pin transform count mismatch/u);
  assert.match(wrapper, /bash -n "\$PATCHED_HELPER"/u);
  assert.match(wrapper, /git hash-object "\$ORIGINAL_HELPER"/u);
});

test("R3 removes the binary Docker 404 body capture from the ephemeral helper", () => {
  assert.match(wrapper, /old_broker_events_status/u);
  assert.match(wrapper, /-o \/dev\/null -w \\"%\{http_code\}\\"/u);
  assert.match(wrapper, /binary broker-events body capture still present/u);
  assert.match(wrapper, /binary_body_capture=absent/u);
});

test("R3 remains preparation-only and fail-closed", () => {
  assert.match(wrapper, /Raspberry Pi 5 Model B/u);
  assert.match(wrapper, /one-shot run directory already exists/u);
  assert.match(wrapper, /helper BLOCKED\/failed; preserve/u);
  assert.doesNotMatch(wrapper, /production-release-controller\.mjs[^\n]*--apply/u);
  assert.doesNotMatch(wrapper, /\bsystemctl\s+(?:restart|start|stop|reload|enable|disable|daemon-reload|reset-failed)\b/u);
  assert.doesNotMatch(wrapper, /\b(?:useradd|usermod|groupadd|groupmod|chown)\b/u);
  assert.doesNotMatch(wrapper, /-X\s+(?:POST|PUT|PATCH|DELETE)\b/u);
  assert.doesNotMatch(wrapper, /actions\/runs\/[^\n]*(?:rerun|cancel)/iu);
  assert.match(wrapper, /PRODUCTION_MUTATION=NO RELEASE_APPLY=NO SYSTEMD_MUTATION=NO/u);
  assert.match(wrapper, /AUTO_RETRY=NO AUTO_CLEANUP=NO/u);
  assert.match(wrapper, /ISSUE126_R3_STOP/u);
});
