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

test("issue186 helper is pinned to the reviewed target, production baseline, and corrective lineage", () => {
  assert.match(helper, /TARGET_SHA="46c47fbd53e6933e2d8db86abdab30edea2badd0"/u);
  assert.match(helper, /TARGET_TREE="4244c8b5105cad996c87c743b3ba90519a4d092a"/u);
  assert.match(helper, /EXPECTED_CURRENT_SHA="a39fc7a9873eedb58cfa49568f9b2e05483cf7c2"/u);
  assert.match(helper, /GATE_BASE_SHA="5bb54d108bcacf5c0c35f9d34a349929d1ca8029"/u);
  assert.match(helper, /GATE_BASE_TREE="ceef7bcc20ace3333d84c9c3d8c5bb8f00b5f925"/u);
  assert.match(helper, /PROCESS_EVIDENCE_FIX_SHA="d65da90a567f3eed6a0d515493dadbe3ef056eb8"/u);
  assert.match(helper, /PROCESS_EVIDENCE_FIX_TREE="25450cc5ed720e59136ab1f6fe36b476a5f40194"/u);
  assert.match(helper, /MODE="preflight"/u);
  assert.match(helper, /AUTHORIZE_ISSUE186_EXACT_MAIN_PRODUCTION_ROLLOUT/u);
  assert.match(helper, /I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ACTIVATION/u);
});

test("preflight dispatcher cannot reach production mutation commands", () => {
  const start = helper.indexOf('if [[ "$MODE" == "preflight" ]]');
  const end = helper.indexOf('[[ "$OWNER_ACK" ==', start);
  assert.ok(start >= 0 && end > start);
  const preflight = helper.slice(start, end);
  assert.doesNotMatch(preflight, /sudo\s/u);
  assert.doesNotMatch(preflight, /systemctl restart/u);
  assert.doesNotMatch(preflight, /--apply/u);
  assert.match(preflight, /write_preflight_receipt/u);

  const receiptStart = helper.indexOf("write_preflight_receipt() {");
  const receiptEnd = helper.indexOf("verify_existing_preflight() {", receiptStart);
  assert.ok(receiptStart >= 0 && receiptEnd > receiptStart);
  const receiptWriter = helper.slice(receiptStart, receiptEnd);
  assert.match(receiptWriter, /PRODUCTION_MUTATION=NO/u);
});

test("live service CWD evidence uses only read-only sudo and fails closed on proc denial", () => {
  const start = helper.indexOf("verify_service_release() {");
  const end = helper.indexOf("verify_security_invariants() {", start);
  assert.ok(start >= 0 && end > start);
  const serviceRelease = helper.slice(start, end);

  assert.ok(serviceRelease.includes('sudo /usr/bin/readlink -f "/proc/${pid}/cwd"'));
  assert.match(serviceRelease, /unable to read \$\{service\} cwd via read-only sudo/u);
  assert.doesNotMatch(serviceRelease, /cwd="\$\(readlink -f/u);
  assert.doesNotMatch(serviceRelease, /systemctl restart/u);
});

test("operator acceptance uses the loopback web trust chain and never direct runtime sockets", () => {
  const start = helper.indexOf("verify_live_acceptance() {");
  const end = helper.indexOf("refresh_github_main() {", start);
  assert.ok(start >= 0 && end > start);
  const acceptance = helper.slice(start, end);

  assert.match(acceptance, /\/api\/health/u);
  assert.match(acceptance, /\/api\/current\/host/u);
  assert.match(acceptance, /\/api\/current\/docker/u);
  assert.match(acceptance, /web-to-agent host trust-chain status/u);
  assert.match(acceptance, /web-to-agent-to-broker Docker trust-chain status/u);
  assert.doesNotMatch(helper, /--unix-socket/u);
  assert.doesNotMatch(helper, /BROKER_SOCKET=/u);
  assert.doesNotMatch(helper, /AGENT_SOCKET=/u);
  assert.doesNotMatch(helper, /http_status_unix/u);
});

test("apply is fail closed and revalidates through web after broker then agent then web restarts", () => {
  const mutation = helper.indexOf('MUTATION_STARTED="YES"');
  const controller = helper.indexOf('sudo /usr/bin/node', mutation);
  const broker = helper.indexOf('sudo systemctl restart "$BROKER_SERVICE"', controller);
  const brokerDocker = helper.indexOf('wait_web_path_200 "/api/current/docker" "broker Docker trust chain"', broker);
  const agent = helper.indexOf('sudo systemctl restart "$AGENT_SERVICE"', brokerDocker);
  const agentHost = helper.indexOf('wait_web_path_200 "/api/current/host" "agent host trust chain"', agent);
  const agentDocker = helper.indexOf('wait_web_path_200 "/api/current/docker" "agent Docker trust chain"', agentHost);
  const web = helper.indexOf('sudo systemctl restart "$WEB_SERVICE"', agentDocker);
  const webDocker = helper.indexOf('wait_web_path_200 "/api/current/docker" "web-to-agent-to-broker Docker trust chain"', web);
  assert.ok(
    mutation >= 0 &&
      controller > mutation &&
      broker > controller &&
      brokerDocker > broker &&
      agent > brokerDocker &&
      agentHost > agent &&
      agentDocker > agentHost &&
      web > agentDocker &&
      webDocker > web,
  );
  assert.match(helper, /STOP_AFTER_MUTATION_ERROR/u);
  assert.match(helper, /NO_RETRY_ROLLBACK_CLEANUP=YES/u);
  assert.doesNotMatch(helper, /systemctl\s+(enable|disable|start|stop|daemon-reload)/u);
  assert.doesNotMatch(helper, /rm\s+-rf/u);
  assert.doesNotMatch(helper, /cloudflared/u);
});

test("GitHub lineage permits only gate base, process-evidence fix, or one exact trust-chain child", () => {
  for (const path of [
    "docs/ISSUE186_EXACT_MAIN_PRODUCTION_ROLLOUT.md",
    "package.json",
    "tools/issue186-exact-main-production-rollout.test.mjs",
    "tools/operator/issue186-exact-main-production-rollout.sh",
  ]) {
    assert.ok(helper.includes(`'${path}'`));
  }

  assert.match(helper, /reviewed issue186 gate base is not a direct child of target/u);
  assert.match(helper, /reviewed process-evidence fix is not a direct child of issue186 gate base/u);
  assert.match(helper, /reviewed process-evidence fix contains unexpected files/u);
  assert.match(helper, /GitHub main is not reviewed process-evidence fix or one direct trust-chain corrective child/u);
  assert.match(helper, /post-process-fix GitHub main contains changes outside reviewed issue186 trust-chain corrective source/u);
  assert.match(helper, /fetch --quiet --depth=4 origin "\$GITHUB_MAIN_SHA"/u);
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