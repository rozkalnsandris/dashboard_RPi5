import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import test from "node:test";
import assert from "node:assert/strict";

const helperPath = resolve("tools/operator/issue186-exact-main-production-rollout.sh");
const helper = await readFile(helperPath, "utf8");

test("issue186 operator helper is valid bash", () => {
  execFileSync("bash", ["-n", helperPath], { stdio: "pipe" });
});

test("issue186 helper is pinned to the reviewed target and accepted production baseline", () => {
  assert.match(helper, /TARGET_SHA="46c47fbd53e6933e2d8db86abdab30edea2badd0"/u);
  assert.match(helper, /TARGET_TREE="4244c8b5105cad996c87c743b3ba90519a4d092a"/u);
  assert.match(helper, /EXPECTED_CURRENT_SHA="a39fc7a9873eedb58cfa49568f9b2e05483cf7c2"/u);
  assert.match(helper, /MODE="preflight"/u);
  assert.match(helper, /AUTHORIZE_ISSUE186_EXACT_MAIN_PRODUCTION_ROLLOUT/u);
  assert.match(helper, /I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ACTIVATION/u);
});

test("preflight path cannot reach production mutation commands", () => {
  const start = helper.indexOf('if [[ "$MODE" == "preflight" ]]');
  const end = helper.indexOf('[[ "$OWNER_ACK" ==', start);
  assert.ok(start >= 0 && end > start);
  const preflight = helper.slice(start, end);
  assert.doesNotMatch(preflight, /sudo\s/u);
  assert.doesNotMatch(preflight, /systemctl restart/u);
  assert.doesNotMatch(preflight, /--apply/u);
  assert.match(preflight, /write_preflight_receipt/u);
  assert.match(preflight, /PRODUCTION_MUTATION=NO/u);
});

test("apply is fail closed and restarts only broker then agent then web", () => {
  const mutation = helper.indexOf('MUTATION_STARTED="YES"');
  const controller = helper.indexOf('sudo /usr/bin/node', mutation);
  const broker = helper.indexOf('sudo systemctl restart "$BROKER_SERVICE"', controller);
  const agent = helper.indexOf('sudo systemctl restart "$AGENT_SERVICE"', broker);
  const web = helper.indexOf('sudo systemctl restart "$WEB_SERVICE"', agent);
  assert.ok(mutation >= 0 && controller > mutation && broker > controller && agent > broker && web > agent);
  assert.match(helper, /STOP_AFTER_MUTATION_ERROR/u);
  assert.match(helper, /NO_RETRY_ROLLBACK_CLEANUP=YES/u);
  assert.doesNotMatch(helper, /systemctl\s+(enable|disable|start|stop|daemon-reload)/u);
  assert.doesNotMatch(helper, /rm\s+-rf/u);
  assert.doesNotMatch(helper, /cloudflared/u);
});

test("post-target GitHub movement is allowed only for the exact issue186 gate-only child", () => {
  for (const path of [
    "docs/ISSUE186_EXACT_MAIN_PRODUCTION_ROLLOUT.md",
    "package.json",
    "tools/issue186-exact-main-production-rollout.test.mjs",
    "tools/operator/issue186-exact-main-production-rollout.sh",
  ]) {
    assert.ok(helper.includes(`'${path}'`));
  }
  assert.match(helper, /GitHub main is not target or one direct gate-only child/u);
  assert.match(helper, /post-target GitHub main contains changes outside issue186 gate source/u);
});

test("target acceptance preserves trust boundaries and proves issue167 headers", () => {
  assert.match(helper, /dashboard-rpi5-agent gained forbidden docker\/video group authority/u);
  assert.match(helper, /terminal socket unexpectedly present/u);
  assert.match(helper, /content-security-policy/u);
  assert.match(helper, /x-content-type-options/u);
  assert.match(helper, /cache-control/u);
  assert.match(helper, /CLOUDFLARE_MUTATION=NO/u);
  assert.match(helper, /SYSTEMD_UNIT_MUTATION=NO/u);
  assert.match(helper, /IDENTITY_PERMISSION_MUTATION=NO/u);
  assert.match(helper, /TERMINAL_ACTIVATION=NO/u);
});
