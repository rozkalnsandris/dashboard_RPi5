import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";
import test from "node:test";

const helperUrl = new URL("./operator/issue126-partial-rollout-recovery.sh", import.meta.url);
const helperPath = fileURLToPath(helperUrl);
const helper = readFileSync(helperUrl, "utf8");

test("#126 partial-rollout recovery helper is valid Bash", () => {
  const result = spawnSync("bash", ["-n", helperPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("recovery binds exact PR174 lineage, target, candidate and mixed-state releases", () => {
  assert.match(helper, /BASE_MAIN="9c5a5f1e9e9fe0a3c2cd67b87c780ab7cc4182e1"/u);
  assert.match(helper, /RECOVERY_PR="174"/u);
  assert.match(helper, /TARGET="a39fc7a9873eedb58cfa49568f9b2e05483cf7c2"/u);
  assert.match(helper, /PREVIOUS_RELEASE="4295c23de5634dcb86b5fe9f57be92416eb9a75b"/u);
  assert.match(helper, /EXPECTED_CANDIDATE="eb3f406f798ad391ab692e81253c0f70dae1acb05ac7b62a6640cfff494818b0"/u);
  assert.match(helper, /EXPECTED_MANIFEST_SHA="ce995eaebe239cf97364d3ef2a5f15516461e9780b591b02c609847e55674821"/u);
  assert.match(helper, /live main is not recovery PR squash merge/u);
  assert.match(helper, /recovery compare must be exactly one squash commit/u);
  assert.match(helper, /recovery exact-head CI not successful/u);
});

test("preflight is fail-closed and recovery requires a new exact owner acknowledgement", () => {
  assert.match(helper, /--preflight-only/u);
  assert.match(helper, /--owner-ack/u);
  assert.match(helper, /I_AUTHORIZE_ISSUE126_PARTIAL_ROLLOUT_RECOVERY_A39FC7A9873EEDB58CFA49568F9B2E05483CF7C2/u);
  assert.match(helper, /ISSUE126_RECOVERY_PREFLIGHT_STOP PRODUCTION_MUTATION=NO AUTHORIZATION_CONSUMED=NO/u);
  assert.match(helper, /ISSUE126_RECOVERY_RACE_GATE_PASS/u);
  assert.match(helper, /MUTATION_STARTED="YES"/u);
});

test("recovery resumes only agent then web and never reapplies release or restarts broker", () => {
  const agent = helper.indexOf('CURRENT_STAGE="restart-agent"');
  const web = helper.indexOf('CURRENT_STAGE="restart-web"');
  assert.ok(agent > 0 && agent < web);
  assert.equal((helper.match(/sudo \/usr\/bin\/systemctl restart/g) ?? []).length, 2);
  assert.doesNotMatch(helper, /systemctl restart "\$BROKER_SERVICE"/u);
  assert.doesNotMatch(helper, /production-release-controller\.mjs --apply/u);
  assert.match(helper, /RELEASE_APPLY=NO/u);
  assert.match(helper, /BROKER_RESTART=NO/u);
});

test("post-restart readiness captures a new stable NRestarts baseline instead of comparing with the pre-restart counter", () => {
  assert.match(helper, /settled_pid=""/u);
  assert.match(helper, /settled_nr=""/u);
  assert.match(helper, /settled_pid="\$pid"/u);
  assert.match(helper, /settled_nr="\$nr"/u);
  assert.match(helper, /\[ "\$pid" = "\$settled_pid" \] \|\| return 5/u);
  assert.match(helper, /\[ "\$nr" = "\$settled_nr" \] \|\| return 6/u);
  assert.match(helper, /read -r new_agent_pid new_agent_nr < <\(wait_agent_ready "\$agent_pid"\)/u);
  assert.match(helper, /read -r new_web_pid new_web_nr < <\(wait_web_ready "\$web_pid"\)/u);
  assert.match(helper, /service_restarts "\$AGENT_SERVICE"\)" = "\$new_agent_nr"/u);
  assert.match(helper, /service_restarts "\$WEB_SERVICE"\)" = "\$new_web_nr"/u);
  assert.doesNotMatch(helper, /wait_agent_ready "\$agent_pid" "\$agent_nr"/u);
  assert.doesNotMatch(helper, /wait_web_ready "\$web_pid" "\$web_nr"/u);
});

test("broker must remain unchanged while bounded events become available through agent and web", () => {
  assert.match(helper, /broker bounded events not 200/u);
  assert.match(helper, /old agent events must remain 503 before recovery/u);
  assert.match(helper, /broker PID drift before recovery/u);
  assert.match(helper, /broker NRestarts drift before recovery/u);
  assert.match(helper, /final broker PID drift/u);
  assert.match(helper, /final broker NRestarts drift/u);
  assert.match(helper, /new agent events not 200/u);
  assert.match(helper, /new web Activity not 200/u);
  assert.match(helper, /ISSUE126_PARTIAL_ROLLOUT_RECOVERY_PASS/u);
});

test("recovery contains no retry, rollback, cleanup or trust-boundary widening path", () => {
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
  assert.match(helper, /PERMISSION_WIDENING=NO/u);
  assert.match(helper, /CLOUDFLARE_MUTATION=NO/u);
  assert.match(helper, /TERMINAL_MUTATION=NO/u);
  assert.match(helper, /ACTIONS_MUTATION=NO/u);
});
