import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helperUrl = new URL("./operator/issue126-production-activation.sh", import.meta.url);
const helperPath = fileURLToPath(helperUrl);
const helper = readFileSync(helperUrl, "utf8");

test("#126 activation helper is valid Bash", () => {
  const result = spawnSync("bash", ["-n", helperPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("activation binds exact PR173 lineage and prepared candidate evidence", () => {
  assert.match(helper, /BASE_MAIN="f87f803e13ec50ec5909b27dc160da7e66621af3"/u);
  assert.match(helper, /ACTIVATION_PR="173"/u);
  assert.match(helper, /TARGET="a39fc7a9873eedb58cfa49568f9b2e05483cf7c2"/u);
  assert.match(helper, /EXPECTED_CANDIDATE="eb3f406f798ad391ab692e81253c0f70dae1acb05ac7b62a6640cfff494818b0"/u);
  assert.match(helper, /EXPECTED_MANIFEST_SHA="ce995eaebe239cf97364d3ef2a5f15516461e9780b591b02c609847e55674821"/u);
  assert.match(helper, /live main is not PR173 squash merge/u);
  assert.match(helper, /PR173 compare must be exactly one squash commit/u);
  assert.match(helper, /PR173 exact-head CI not successful/u);
  assert.match(helper, /candidate manifest verification failed/u);
});

test("preflight is fail-closed and activation requires exact owner acknowledgement", () => {
  assert.match(helper, /--preflight-only/u);
  assert.match(helper, /--owner-ack/u);
  assert.match(helper, /I_AUTHORIZE_ISSUE126_PRODUCTION_ACTIVATION_A39FC7A9873EEDB58CFA49568F9B2E05483CF7C2/u);
  assert.match(helper, /ISSUE126_ACTIVATION_PREFLIGHT_STOP PRODUCTION_MUTATION=NO AUTHORIZATION_CONSUMED=NO/u);
  assert.match(helper, /ISSUE126_ACTIVATION_RACE_GATE_PASS/u);
  assert.match(helper, /MUTATION_STARTED="YES"/u);
});

test("mutation order is release apply then broker then agent then web exactly once", () => {
  const apply = helper.indexOf('CURRENT_STAGE="release-apply"');
  const broker = helper.indexOf('CURRENT_STAGE="restart-broker"');
  const agent = helper.indexOf('CURRENT_STAGE="restart-agent"');
  const web = helper.indexOf('CURRENT_STAGE="restart-web"');
  assert.ok(apply > 0 && apply < broker && broker < agent && agent < web);
  assert.equal((helper.match(/sudo \/usr\/bin\/systemctl restart/g) ?? []).length, 3);
  assert.equal((helper.match(/production-release-controller\.mjs --apply/g) ?? []).length, 1);
  assert.match(helper, /--expected-current "\$EXPECTED_CURRENT" --ack "\$RELEASE_ACK"/u);
});

test("application readiness and final P3 acceptance are explicit", () => {
  assert.match(helper, /wait_broker_ready/u);
  assert.match(helper, /wait_agent_ready/u);
  assert.match(helper, /wait_web_ready/u);
  assert.match(helper, /broker events must be 404 before activation/u);
  assert.match(helper, /new broker events not 200/u);
  assert.match(helper, /new agent events not 200/u);
  assert.match(helper, /new web Activity not 200/u);
  assert.match(helper, /ISSUE126_PRODUCTION_ACTIVATION_PASS/u);
  assert.match(helper, /terminal=absent access=302/u);
});

test("helper contains no alternate mutation, retry, rollback, cleanup or trust-boundary widening path", () => {
  for (const forbidden of [
    /systemctl\s+(?:daemon-reload|enable|disable|start|stop|reset-failed)/u,
    /\b(?:usermod|groupmod|groupadd|useradd|setfacl)\b/u,
    /\b(?:wrangler|cloudflared)\b/u,
    /\bgh\s+run\b/u,
    /\brm\s+-/u,
    /\bmv\s+/u,
    /\bchmod\s+/u,
    /\bchown\s+/u,
  ]) {
    assert.doesNotMatch(helper, forbidden);
  }
  assert.match(helper, /AUTO_RETRY=NO/u);
  assert.match(helper, /AUTO_ROLLBACK=NO/u);
  assert.match(helper, /AUTO_CLEANUP=NO/u);
  assert.match(helper, /SYSTEMD_UNIT_MUTATION=NO/u);
  assert.match(helper, /IDENTITY_MUTATION=NO/u);
  assert.match(helper, /CLOUDFLARE_MUTATION=NO/u);
  assert.match(helper, /TERMINAL_MUTATION=NO/u);
  assert.match(helper, /ACTIONS_MUTATION=NO/u);
});
