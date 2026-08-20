import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELPER = resolve(ROOT, "tools/operator/issue151-agent-web-cutover.sh");

async function source() {
  return readFile(HELPER, "utf8");
}

test("continuation binds exact post-mutation live broker and old agent/web baseline", async () => {
  const text = await source();
  assert.ok(text.includes('EXPECTED_BROKER_PID="1081746"'));
  assert.ok(text.includes('EXPECTED_BROKER_NRESTARTS="14582"'));
  assert.ok(text.includes('EXPECTED_AGENT_PID="3482974"'));
  assert.ok(text.includes('EXPECTED_WEB_PID="3378022"'));
  assert.ok(text.includes('PREVIOUS_RELEASE="15f44e3a6fdda8f2e97b26501a283f6bba915e86"'));
  assert.ok(text.includes("assert_broker_healthy_exact"));
});

test("healthy broker is a preflight invariant and never mutated", async () => {
  const text = await source();
  assert.ok(text.includes("assert_broker_healthy_exact"));
  assert.ok(text.includes("post-agent-broker-reproof"));
  assert.ok(text.includes("BROKER_MUTATION=NO"));
  for (const forbidden of [
    'systemctl restart "$BROKER_SERVICE"',
    'systemctl start "$BROKER_SERVICE"',
    'systemctl stop "$BROKER_SERVICE"',
    'systemctl reset-failed "$BROKER_SERVICE"',
  ]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test("only agent then web restart are allowed after authorization", async () => {
  const text = await source();
  const mutation = text.indexOf('ISSUE151_CUTOVER_MUTATION_STARTED');
  const agent = text.indexOf('systemctl restart "$AGENT_SERVICE"');
  const agentPass = text.indexOf('ISSUE151_CUTOVER_AGENT_PASS');
  const web = text.indexOf('systemctl restart "$WEB_SERVICE"');
  const webPass = text.indexOf('ISSUE151_CUTOVER_WEB_PASS');
  assert.ok(mutation > 0);
  assert.ok(agent > mutation);
  assert.ok(agentPass > agent);
  assert.ok(web > agentPass);
  assert.ok(webPass > web);
  assert.equal((text.match(/systemctl restart "\$AGENT_SERVICE"/g) ?? []).length, 1);
  assert.equal((text.match(/systemctl restart "\$WEB_SERVICE"/g) ?? []).length, 1);
});

test("Type=exec services use bounded application readiness rather than active alone", async () => {
  const text = await source();
  assert.ok(text.includes("wait_agent_ready()"));
  assert.ok(text.includes("wait_web_ready()"));
  assert.ok(text.includes("for ((index=0; index<75; index+=1))"));
  assert.ok(text.includes('privileged_socket_exists "$AGENT_SOCKET"'));
  assert.ok(text.includes("'/v1/host/summary'"));
  assert.ok(text.includes("'/api/health'"));
  assert.ok(text.includes('NRestarts --value'));
  assert.ok(text.includes('readlink -f "/proc/$pid/cwd"'));
});

test("agent acceptance proves logs and preserved trust boundaries before web restart", async () => {
  const text = await source();
  assert.ok(text.includes("homeassistant_logs=200"));
  assert.ok(text.includes("prometheus_logs=200"));
  assert.ok(text.includes("validate_log_snapshot"));
  assert.ok(text.includes("agent Docker events not 503"));
  assert.ok(text.includes("agent Quick Commands"));
  assert.ok(text.includes("agent unexpectedly has Docker runtime group"));
  assert.ok(text.includes("agent unexpectedly has video runtime group"));
  assert.ok(text.includes("terminal/PTTY appeared after agent restart"));
});

test("web acceptance proves loopback health, product APIs and logs", async () => {
  const text = await source();
  assert.ok(text.includes("'/api/health'"));
  assert.ok(text.includes("'/api/current/host'"));
  assert.ok(text.includes("'/api/current/docker'"));
  assert.ok(text.includes('"/api/logs?sourceId=$encoded&range=15m"'));
  assert.ok(text.includes("'/api/quick-commands'"));
  assert.ok(text.includes("web unexpectedly has broker-client runtime group"));
});

test("preflight and failure semantics preserve one-shot authorization boundary", async () => {
  const text = await source();
  assert.ok(text.includes("--preflight-only"));
  assert.ok(text.includes("--owner-ack"));
  assert.ok(text.includes('EXPECTED_OWNER_ACK="I_AUTHORIZE_ISSUE151_AGENT_WEB_CUTOVER_4295C23DE5634DCB86B5FE9F57BE92416EB9A75B"'));
  assert.ok(text.includes("AUTHORIZATION_CONSUMED=NO"));
  assert.ok(text.includes("AUTHORIZATION_CONSUMED=YES"));
  assert.ok(text.includes("AUTO_RETRY=NO"));
  assert.ok(text.includes("AUTO_ROLLBACK=NO"));
  assert.ok(text.includes("AUTO_CLEANUP=NO"));
});

test("continuation contains no permission, unit, identity, Cloudflare or events mutation path", async () => {
  const text = await source();
  for (const forbidden of [
    "chmod ",
    "chown ",
    "daemon-reload",
    "usermod",
    "groupmod",
    "gpasswd",
    "wrangler",
    "cloudflared",
    "docker events",
    "rm -rf",
  ]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  assert.ok(text.includes("PERMISSION_MUTATION=NO"));
  assert.ok(text.includes("SYSTEMD_UNIT_MUTATION=NO"));
  assert.ok(text.includes("IDENTITY_GROUP_MUTATION=NO"));
  assert.ok(text.includes("CLOUDFLARE_MUTATION=NO"));
  assert.ok(text.includes("EVENTS_MUTATION=NO"));
});

test("final proof keeps broker exact and verifies target, units, events, quick, terminal and Access", async () => {
  const text = await source();
  const final = text.indexOf('CURRENT_STAGE="postmutation-final-proof"');
  assert.ok(final > 0);
  assert.ok(text.indexOf("assert_broker_healthy_exact", final) > final);
  assert.ok(text.indexOf("verify_target_manifest", final) > final);
  assert.ok(text.indexOf("Quick Commands drop-in changed", final) > final);
  assert.ok(text.indexOf("final events not 503", final) > final);
  assert.ok(text.indexOf("terminal/PTTY present at final proof", final) > final);
  assert.ok(text.indexOf("final Cloudflare Access not 302", final) > final);
  assert.ok(text.includes("ISSUE151_CUTOVER_PASS"));
  assert.ok(text.includes("ISSUE151_CUTOVER_FINAL"));
});
