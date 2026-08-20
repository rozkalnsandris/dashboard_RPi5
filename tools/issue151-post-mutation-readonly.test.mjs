import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELPER = resolve(ROOT, "tools/operator/issue151-post-mutation-readonly.sh");

async function source() {
  return readFile(HELPER, "utf8");
}

test("post-mutation #151 helper is intentionally read-only", async () => {
  const text = await source();
  assert.ok(text.includes("READ-ONLY ONLY"));
  assert.ok(text.includes("PRODUCTION_MUTATION=NO"));
  assert.ok(text.includes("AUTHORIZATION_CONSUMED=YES"));

  for (const forbidden of [
    "systemctl start",
    "systemctl stop",
    "systemctl restart",
    "systemctl enable",
    "systemctl disable",
    "daemon-reload",
    "chmod ",
    "chown ",
    "rm -rf",
    "rollback",
    "wrangler",
    "cloudflared",
  ]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test("socket evidence is privilege-aware behind RuntimeDirectoryMode 0750", async () => {
  const text = await source();
  assert.ok(text.includes('BROKER_RUNTIME_DIR="/run/dashboard-rpi5-docker-broker"'));
  assert.ok(text.includes('sudo test -S "$1"'));
  assert.ok(text.includes('sudo stat -Lc \'%U:%G:%a:%F\' "$BROKER_RUNTIME_DIR"'));
  assert.ok(text.includes('sudo stat -Lc \'%U:%G:%a:%F\' "$BROKER_SOCKET"'));
  assert.ok(text.includes('$BROKER_USER:$BROKER_GROUP:750:directory'));
  assert.ok(text.includes('$BROKER_USER:$BROKER_GROUP:660:socket'));
  assert.equal(text.includes('[ -S "$BROKER_SOCKET" ]'), false);
  assert.equal(text.includes('[ ! -S "$BROKER_SOCKET" ]'), false);
});

test("Type=exec acceptance does not equate active with application readiness", async () => {
  const text = await source();
  const activeIndex = text.indexOf('broker_active="$(systemctl is-active');
  const waitIndex = text.indexOf('wait_privileged_socket "$BROKER_SERVICE"');
  const healthIndex = text.indexOf("'/v1/health'");
  assert.ok(activeIndex > 0);
  assert.ok(waitIndex > activeIndex);
  assert.ok(healthIndex > waitIndex);
  assert.ok(text.includes("BROKER_HEALTHY_POST_START"));
  assert.ok(text.includes("BROKER_ACTIVE_SOCKET_UNPROVEN"));
});

test("bounded readiness detects PID/restart churn instead of masking it", async () => {
  const text = await source();
  assert.ok(text.includes("for ((index=0; index<50; index+=1))"));
  assert.ok(text.includes('pid="$(systemctl show "$service" -p MainPID --value)"'));
  assert.ok(text.includes('[ "$pid" = "$expected_pid" ] || return 3'));
  assert.ok(text.includes("broker_nrestarts_before"));
  assert.ok(text.includes("broker_nrestarts_after"));
  assert.ok(text.includes("restart_stable"));
});

test("diagnostic binds normalized target and untouched agent/web boundary", async () => {
  const text = await source();
  assert.ok(text.includes('TARGET="4295c23de5634dcb86b5fe9f57be92416eb9a75b"'));
  assert.ok(text.includes('EXPECTED_AGENT_PID="3482974"'));
  assert.ok(text.includes('EXPECTED_WEB_PID="3378022"'));
  assert.ok(text.includes("metadata_pass"));
  assert.ok(text.includes("target manifest verification failed"));
  assert.ok(text.includes("agent cwd drift"));
  assert.ok(text.includes("web cwd drift"));
});

test("diagnostic records Node import.meta.main compatibility boundary", async () => {
  const text = await source();
  assert.ok(text.includes("node_import_meta_main"));
  assert.ok(text.includes('[ "$node_major" -eq 24 ] && [ "$node_minor" -ge 2 ]'));
  assert.ok(text.includes("import_meta_main_supported"));
});

test("diagnostic proves installed units and Cloudflare boundary read-only", async () => {
  const text = await source();
  assert.ok(text.includes('BROKER_UNIT_SOURCE="$TARGET_RELEASE/ops/systemd/dashboard-rpi5-docker-broker.service"'));
  assert.ok(text.includes('installed unit drift'));
  assert.ok(text.includes('access_probe()'));
  assert.ok(text.includes('ISSUE151_ACCESS_CODE'));
  assert.ok(text.includes('cloudflare-access'));
});
