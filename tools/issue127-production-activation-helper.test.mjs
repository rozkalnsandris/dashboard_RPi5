import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { URL } from "node:url";

const helperPath = new URL("./operator/issue127-production-activate.sh", import.meta.url);
const source = readFileSync(helperPath, "utf8");

const TARGET = "4295c23de5634dcb86b5fe9f57be92416eb9a75b";
const TREE = "df24c7e8e2047176c43f24989e4910a30fa1bc02";
const CURRENT = "15f44e3a6fdda8f2e97b26501a283f6bba915e86";
const CANDIDATE = "f08677aef82d0213422a171b51efd46fa7db57b29385fdd9c5d185f2c7b83eb0";
const MANIFEST = "5e7ed7f70987f93291567b880053a1f46d911f51ce678690fd61bc9f097c60ff";
const RUN_ID = "32278079231";
const CHECK_JOB = "96174756688";

function indexOfRequired(text) {
  const index = source.indexOf(text);
  assert.notEqual(index, -1, `missing: ${text}`);
  return index;
}

test("activation helper is valid bash", () => {
  const result = spawnSync("bash", ["-n", helperPath.pathname], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("activation helper binds exact source, recovered CI and prepared candidate", () => {
  assert.match(source, new RegExp(`TARGET="${TARGET}"`));
  assert.match(source, new RegExp(`EXPECTED_TREE="${TREE}"`));
  assert.match(source, new RegExp(`EXPECTED_CURRENT="${CURRENT}"`));
  assert.match(source, new RegExp(`EXPECTED_CANDIDATE="${CANDIDATE}"`));
  assert.match(source, new RegExp(`EXPECTED_MANIFEST_SHA="${MANIFEST}"`));
  assert.match(source, new RegExp(`EXPECTED_CI_RUN_ID="${RUN_ID}"`));
  assert.match(source, /EXPECTED_CI_RUN_NUMBER="318"/);
  assert.match(source, /EXPECTED_CI_RUN_ATTEMPT="2"/);
  assert.match(source, new RegExp(`EXPECTED_CHECK_JOB_ID="${CHECK_JOB}"`));
  assert.match(source, /EXPECTED_FILES="61"/);
  assert.match(source, /EXPECTED_BYTES="6531049"/);
  assert.match(source, /dashboard-rpi5-candidate-recovery/);
  assert.match(source, /issue127-ci318-a2/);
});

test("preflight-only mode stops before the mutation boundary", () => {
  assert.match(source, /--preflight-only/);
  assert.match(source, /--owner-ack/);
  assert.match(source, /ISSUE127_ACTIVATION_PREFLIGHT_ONLY_STOP PRODUCTION_MUTATION=NO AUTHORIZATION_CONSUMED=NO/);

  const preflightStop = indexOfRequired("ISSUE127_ACTIVATION_PREFLIGHT_ONLY_STOP");
  const mutationStart = indexOfRequired('MUTATION_STARTED="YES"');
  const releaseApply = indexOfRequired('--expected-current "$EXPECTED_CURRENT" --apply');
  assert.ok(preflightStop < mutationStart);
  assert.ok(mutationStart < releaseApply);
});

test("authorization is exact and consumed only immediately before first mutation", () => {
  assert.match(
    source,
    /EXPECTED_OWNER_ACK="I_AUTHORIZE_ISSUE127_DOCKER_LOGS_PRODUCTION_ACTIVATION_F08677AEF82D0213422A171B51EFD46FA7DB57B29385FDD9C5D185F2C7B83EB0"/,
  );
  assert.match(source, /\[ "\$2" = "\$EXPECTED_OWNER_ACK" \] \|\| stop "owner acknowledgement mismatch"/);
  assert.match(source, /ISSUE127_ACTIVATION_MUTATION_STARTED stage=\$CURRENT_STAGE AUTHORIZATION_CONSUMED=YES/);
  assert.match(source, /AUTO_RETRY=NO AUTO_ROLLBACK=NO AUTO_CLEANUP=NO/);
});

test("future mutation surface is only release apply plus one broker, agent and web restart", () => {
  assert.equal((source.match(/--apply\b/g) ?? []).length, 1);
  assert.equal((source.match(/sudo \/usr\/bin\/systemctl restart "\$BROKER_SERVICE"/g) ?? []).length, 1);
  assert.equal((source.match(/sudo \/usr\/bin\/systemctl restart "\$AGENT_SERVICE"/g) ?? []).length, 1);
  assert.equal((source.match(/sudo \/usr\/bin\/systemctl restart "\$WEB_SERVICE"/g) ?? []).length, 1);

  assert.doesNotMatch(source, /^\s*(?:sudo\s+)?(?:\/usr\/bin\/)?systemctl\s+(?:start|stop|reload|enable|disable|daemon-reload)\b/m);
  assert.doesNotMatch(source, /\b(?:useradd|usermod|userdel|groupadd|groupmod|groupdel|gpasswd|chmod|chown)\b/);
  assert.doesNotMatch(source, /\brm\s+-rf\b/);
  assert.doesNotMatch(source, /\bunlink\b/);
  assert.doesNotMatch(source, /actions\/runs\/[^\s"']+\/(?:rerun|cancel)/);
  assert.doesNotMatch(source, /\b(?:cloudflared|wrangler)\b/);
});

test("cutover order is release then broker acceptance then agent acceptance then web", () => {
  const apply = indexOfRequired('--expected-current "$EXPECTED_CURRENT" --apply');
  const brokerRestart = indexOfRequired('restart "$BROKER_SERVICE"');
  const brokerPass = indexOfRequired("ISSUE127_ACTIVATION_BROKER_PASS");
  const agentRestart = indexOfRequired('restart "$AGENT_SERVICE"');
  const agentPass = indexOfRequired("ISSUE127_ACTIVATION_AGENT_PASS");
  const webRestart = indexOfRequired('restart "$WEB_SERVICE"');
  const webPass = indexOfRequired("ISSUE127_ACTIVATION_WEB_PASS");
  const finalPass = indexOfRequired("ISSUE127_ACTIVATION_PASS target=");

  assert.ok(apply < brokerRestart);
  assert.ok(brokerRestart < brokerPass);
  assert.ok(brokerPass < agentRestart);
  assert.ok(agentRestart < agentPass);
  assert.ok(agentPass < webRestart);
  assert.ok(webRestart < webPass);
  assert.ok(webPass < finalPass);
});

test("broker acceptance proves bounded #127 routes and rejects widening", () => {
  assert.match(source, /DOCKER_BROKER_LOG_MAX_RESPONSE_BYTES = 512 \* 1024/);
  assert.match(source, /DOCKER_BROKER_LOG_TAIL = 400/);
  assert.match(source, /DOCKER_BROKER_LOG_SOURCES = \["homeassistant", "prometheus"\]/);
  assert.match(source, /DOCKER_BROKER_LOG_RANGES = \["15m", "1h", "6h", "24h"\]/);
  assert.match(source, /\/v1\/docker\/logs\/homeassistant\/15m/);
  assert.match(source, /\/v1\/docker\/logs\/prometheus\/24h/);
  assert.match(source, /\/v1\/docker\/logs\/homeassistant\/7d/);
  assert.match(source, /\/v1\/docker\/logs\/unknown\/15m/);
  assert.match(source, /\/v1\/docker\/images\/json/);
  assert.match(source, /\/v1\/docker\/events/);
});

test("agent and web acceptance require typed log snapshots for both Docker sources", () => {
  assert.match(source, /docker%3Ahomeassistant\|docker:homeassistant/);
  assert.match(source, /docker%3Aprometheus\|docker:prometheus/);
  assert.match(source, /\/v1\/logs\?sourceId=\$encoded&range=15m/);
  assert.match(source, /\/api\/logs\?sourceId=\$encoded&range=15m/);
  assert.match(source, /\.source\.kind == "DOCKER"/);
  assert.match(source, /\.source\.rangeMode == "TIME"/);
  assert.match(source, /\.rangeApplied == true/);
  assert.match(source, /\.entries \| type == "array" and length <= 400/);
});

test("preserved production boundaries remain explicit", () => {
  assert.match(source, /Docker events should remain 503 pending #126/);
  assert.match(source, /Quick Commands/);
  assert.match(source, /\["host\.disk-root","host\.failed-units","host\.kernel","host\.uptime"\]/);
  assert.match(source, /terminal\/PTTY socket/);
  assert.match(source, /ISSUE127_ACCESS_CODE:302/);
  assert.match(source, /main agent persistent group boundary violated/);
  assert.match(source, /agent runtime Docker group appeared/);
  assert.match(source, /SYSTEMD_UNIT_MUTATION=NO/);
  assert.match(source, /IDENTITY_MUTATION=NO/);
  assert.match(source, /PERMISSION_MUTATION=NO/);
  assert.match(source, /CLOUDFLARE_MUTATION=NO/);
  assert.match(source, /TERMINAL_MUTATION=NO/);
  assert.match(source, /ACTIONS_MUTATION=NO/);
});
