import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELPER_PATH = resolve(ROOT, "tools/operator/issue126-production-candidate-prep.sh");
const helper = await readFile(HELPER_PATH, "utf8");

test("#126 candidate-prep helper is valid Bash", () => {
  const result = spawnSync("bash", ["-n", HELPER_PATH], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("helper binds exact merged #160 source tree and CI evidence", () => {
  assert.match(helper, /TARGET="a39fc7a9873eedb58cfa49568f9b2e05483cf7c2"/u);
  assert.match(helper, /TARGET_TREE="bd2fa68711b1cf4617088a18c524e3c60d427152"/u);
  assert.match(helper, /SOURCE_PR="160"/u);
  assert.match(helper, /SOURCE_PR_HEAD="a44e95b4b480e29b8d537130903869c00fc3ef0d"/u);
  assert.match(helper, /SOURCE_CI_RUN_ID="32407296336"/u);
  assert.match(helper, /SOURCE_CI_RUN_NUMBER="368"/u);
  assert.match(helper, /PR160 head tree differs from merged main tree/u);
  assert.match(helper, /ISSUE126_SOURCE_GATE_PASS/u);
});

test("helper binds the accepted production release without hard-coding mutable PIDs", () => {
  assert.match(helper, /EXPECTED_CURRENT="4295c23de5634dcb86b5fe9f57be92416eb9a75b"/u);
  assert.match(helper, /EXPECTED_CURRENT_CANDIDATE="f08677aef82d0213422a171b51efd46fa7db57b29385fdd9c5d185f2c7b83eb0"/u);
  assert.match(helper, /broker_pid="\$\(systemctl show/u);
  assert.match(helper, /agent_pid="\$\(systemctl show/u);
  assert.match(helper, /web_pid="\$\(systemctl show/u);
  assert.doesNotMatch(helper, /broker_pid="1081746"|agent_pid="1202029"|web_pid="1202343"/u);
});

test("preflight preserves the current fast-track production boundary", () => {
  assert.match(helper, /Docker logs not 200/u);
  assert.match(helper, /Docker events must remain 503 before #126 activation/u);
  assert.match(helper, /Quick Commands catalog not 200/u);
  assert.match(helper, /terminal\/PTTY runtime socket unexpectedly exists/u);
  assert.match(helper, /Access expected 302/u);
  assert.match(helper, /agent runtime Docker group appeared/u);
  assert.match(helper, /agent runtime video group appeared/u);
  assert.match(helper, /current broker unexpectedly exposes #126 route/u);
});

test("source gate pins bounded events rather than a generic Docker proxy", () => {
  assert.match(helper, /DOCKER_BROKER_EVENTS_PATH = "\/v1\/docker\/events\/recent"/u);
  assert.match(helper, /DOCKER_BROKER_EVENTS_MAX_WINDOW_SECONDS = 60 \* 60/u);
  assert.match(helper, /DOCKER_BROKER_EVENTS_MAX_ITEMS = 512/u);
  assert.match(helper, /DOCKER_EVENTS_LOOKBACK_SECONDS = 60 \* 60/u);
  assert.match(helper, /DOCKER_EVENTS_MAX_ITEMS = 256/u);
  assert.match(helper, /method: "GET"/u);
  assert.match(helper, /broker\.readEvents\(since, until, signal\)/u);
  assert.match(helper, /dockerEventsReader: \(signal\) => readLiveRecentDockerEvents\(signal\)/u);
});

test("candidate preparation uses fresh home cache, full validation and release PLAN only", () => {
  assert.match(helper, /WORKSPACE="\$HOME\/\.cache\/dashboard-rpi5-candidate-prep\/\$\{TARGET\}-issue126"/u);
  assert.match(helper, /workspace exists; no auto-reuse\/cleanup/u);
  assert.match(helper, /npm ci --ignore-scripts && npm audit --audit-level=high && npm run check/u);
  assert.match(helper, /production-candidate-manifest\.mjs/u);
  assert.match(helper, /production-runtime-smoke\.mjs/u);
  assert.match(helper, /production-release-controller\.mjs --candidate-root/u);
  assert.doesNotMatch(helper, /production-release-controller\.mjs[^\n]*--apply/u);
  assert.match(helper, /release PLAN status mismatch/u);
  assert.match(helper, /targetRelease'\)" = absent/u);
});

test("helper contains no production mutation or automatic recovery primitive", () => {
  assert.doesNotMatch(helper, /\bsystemctl\s+(?:restart|start|stop|reload|enable|disable|daemon-reload|reset-failed)\b/u);
  assert.doesNotMatch(helper, /\b(?:useradd|usermod|groupadd|groupmod|chown|chmod)\b/u);
  assert.doesNotMatch(helper, /\brm\s+-rf\b/u);
  assert.doesNotMatch(helper, /\b(?:mv|cp|install)\s+[^\n]*(?:\/opt\/dashboard_RPi5|\/etc\/systemd)/u);
  assert.doesNotMatch(helper, /-X\s+(?:POST|PUT|PATCH|DELETE)\b/u);
  assert.doesNotMatch(helper, /actions\/runs\/[^\n]*(?:rerun|cancel)/iu);
  assert.match(helper, /PRODUCTION_MUTATION=NO RELEASE_APPLY=NO SYSTEMD_MUTATION=NO/u);
  assert.match(helper, /AUTO_RETRY=NO AUTO_CLEANUP=NO/u);
});

test("final reproof requires PIDs/restart counters/current pointer unchanged and stops before activation", () => {
  assert.match(helper, /broker PID changed during prep/u);
  assert.match(helper, /agent PID changed during prep/u);
  assert.match(helper, /web PID changed during prep/u);
  assert.match(helper, /broker restart count changed/u);
  assert.match(helper, /agent restart count changed/u);
  assert.match(helper, /web restart count changed/u);
  assert.match(helper, /current pointer changed during prep/u);
  assert.match(helper, /ISSUE126_CANDIDATE_PREPARATION_READY/u);
  assert.match(helper, /ISSUE126_CANDIDATE_PREP_STOP/u);
  assert.match(helper, /release_apply=NO/u);
  assert.match(helper, /events=503/u);
});
