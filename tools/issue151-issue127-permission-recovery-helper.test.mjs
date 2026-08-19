import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELPER = resolve(ROOT, "tools/operator/issue151-issue127-permission-recovery.sh");
const TARGET = "4295c23de5634dcb86b5fe9f57be92416eb9a75b";
const CANDIDATE = "f08677aef82d0213422a171b51efd46fa7db57b29385fdd9c5d185f2c7b83eb0";
const ACK = "I_AUTHORIZE_ISSUE151_ISSUE127_PERMISSION_RECOVERY_4295C23DE5634DCB86B5FE9F57BE92416EB9A75B";

async function helperSource() {
  return readFile(HELPER, "utf8");
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

test("#151 recovery helper is valid Bash", () => {
  const result = spawnSync("bash", ["-n", HELPER], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("#151 helper binds the exact failed #127 target and owner gate", async () => {
  const source = await helperSource();
  assert.match(source, new RegExp(`TARGET="${TARGET}"`, "u"));
  assert.match(source, new RegExp(`EXPECTED_CANDIDATE="${CANDIDATE}"`, "u"));
  assert.ok(source.includes(`EXPECTED_OWNER_ACK="${ACK}"`));
  assert.ok(source.includes('PREVIOUS_RELEASE="15f44e3a6fdda8f2e97b26501a283f6bba915e86"'));
  assert.ok(source.includes('EXPECTED_BROKER_ENTRY_SHA="a9fdbf13c704b0c9bc1d03ec5698198630a967d282644fb3440dfab2ff8de05d"'));
  assert.ok(source.includes('EXPECTED_AGENT_PID="3482974"'));
  assert.ok(source.includes('EXPECTED_WEB_PID="3378022"'));
});

test("preflight proves the observed CHDIR incident and stops before mutation", async () => {
  const source = await helperSource();
  const preauth = source.indexOf("ISSUE151_RECOVERY_PREAUTH_PASS");
  const preflightStop = source.indexOf("ISSUE151_RECOVERY_PREFLIGHT_ONLY_STOP");
  const mutation = source.indexOf('MUTATION_STARTED="YES"');
  assert.ok(preauth > 0 && preflightStop > preauth && mutation > preflightStop);
  assert.ok(source.includes('[ "$release_mode" = 700 ]'));
  assert.ok(source.includes('[ "$broker_entry_mode" = 600 ]'));
  assert.ok(source.includes('-p ExecMainStatus --value)" = 200'));
  assert.ok(source.includes('-p Result --value)" = exit-code'));
  assert.ok(source.includes('AUTHORIZATION_CONSUMED=NO BROKER_STOP=NO OWNERSHIP_MUTATION=NO PERMISSION_MUTATION=NO'));
});

test("recovery metadata normalization is exact and bounded to the verified target", async () => {
  const source = await helperSource();
  assert.equal(count(source, 'sudo /usr/bin/systemctl stop "$BROKER_SERVICE"'), 1);
  assert.equal(count(source, 'sudo /usr/bin/systemctl start "$BROKER_SERVICE"'), 1);
  assert.ok(source.includes('sudo /usr/bin/find "$TARGET_RELEASE" -xdev -type d -exec /usr/bin/chown root:root -- {} +'));
  assert.ok(source.includes('sudo /usr/bin/find "$TARGET_RELEASE" -xdev -type f -exec /usr/bin/chown root:root -- {} +'));
  assert.ok(source.includes('sudo /usr/bin/find "$TARGET_RELEASE" -xdev -type d -exec /usr/bin/chmod 0755 -- {} +'));
  assert.ok(source.includes('sudo /usr/bin/find "$TARGET_RELEASE" -xdev -type f ! -path "$MANIFEST_MARKER" -exec /usr/bin/chmod 0644 -- {} +'));
  assert.ok(source.includes('sudo /usr/bin/chmod 0600 "$MANIFEST_MARKER"'));
  assert.ok(source.includes("assert_target_metadata_normalized"));
  assert.ok(source.includes('verify_target_manifest || stop "target manifest failed after metadata normalization"'));
});

test("cutover order is stop -> metadata -> broker -> agent -> web -> final", async () => {
  const source = await helperSource();
  const stopBroker = source.indexOf('sudo /usr/bin/systemctl stop "$BROKER_SERVICE"');
  const metadata = source.indexOf('CURRENT_STAGE="mutation-normalize-target-metadata"');
  const metadataPass = source.indexOf("ISSUE151_RECOVERY_METADATA_PASS");
  const startBroker = source.indexOf('sudo /usr/bin/systemctl start "$BROKER_SERVICE"');
  const brokerPass = source.indexOf("ISSUE151_RECOVERY_BROKER_PASS");
  const restartAgent = source.indexOf('sudo /usr/bin/systemctl restart "$AGENT_SERVICE"');
  const agentPass = source.indexOf("ISSUE151_RECOVERY_AGENT_PASS");
  const restartWeb = source.indexOf('sudo /usr/bin/systemctl restart "$WEB_SERVICE"');
  const webPass = source.indexOf("ISSUE151_RECOVERY_WEB_PASS");
  const finalProof = source.indexOf('CURRENT_STAGE="postmutation-final-proof"');
  assert.ok(stopBroker > 0);
  assert.ok(stopBroker < metadata && metadata < metadataPass);
  assert.ok(metadataPass < startBroker && startBroker < brokerPass);
  assert.ok(brokerPass < restartAgent && restartAgent < agentPass);
  assert.ok(agentPass < restartWeb && restartWeb < webPass);
  assert.ok(webPass < finalProof);
});

test("recovery has exactly one intended service command per cutover step", async () => {
  const source = await helperSource();
  assert.equal(count(source, 'systemctl restart "$BROKER_SERVICE"'), 0);
  assert.equal(count(source, 'systemctl stop "$AGENT_SERVICE"'), 0);
  assert.equal(count(source, 'systemctl stop "$WEB_SERVICE"'), 0);
  assert.equal(count(source, 'systemctl start "$AGENT_SERVICE"'), 0);
  assert.equal(count(source, 'systemctl start "$WEB_SERVICE"'), 0);
  assert.equal(count(source, 'sudo /usr/bin/systemctl restart "$AGENT_SERVICE"'), 1);
  assert.equal(count(source, 'sudo /usr/bin/systemctl restart "$WEB_SERVICE"'), 1);
});

test("recovery preserves #127 trust boundaries and #126/terminal fail-closed state", async () => {
  const source = await helperSource();
  for (const evidence of [
    "/v1/docker/logs/homeassistant/15m",
    "/v1/docker/logs/prometheus/24h",
    "/v1/docker/logs/homeassistant/7d",
    "/v1/docker/logs/unknown/15m",
    "/v1/docker/images/json",
    "/v1/docker/events",
    "/v1/docker/events/recent",
    "/v1/quick-commands",
    "terminal/PTTY",
    "cloudflare-access",
  ]) {
    assert.ok(source.toLowerCase().includes(evidence.toLowerCase()), evidence);
  }
  assert.ok(source.includes("for forbidden_group in docker video \"$BROKER_GROUP\""));
  assert.ok(source.includes('proc_has_gid "$new_broker_pid" "$docker_gid"'));
  assert.ok(source.includes('proc_has_gid "$new_agent_pid" "$broker_gid"'));
});

test("post-mutation failure policy has no automatic repair path", async () => {
  const source = await helperSource();
  assert.ok(source.includes("AUTO_RETRY=NO AUTO_ROLLBACK=NO AUTO_CLEANUP=NO"));
  assert.ok(source.includes("ALTERNATE_PERMISSION_CHANGE=NO"));
  for (const forbidden of [
    "reset-failed",
    "daemon-reload",
    "systemctl enable",
    "systemctl disable",
    "wrangler",
    "cloudflared",
    "rerun-failed",
    "actions/runs/",
    "rollback --apply",
    "rm -rf",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
