import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const smokeUrl = new URL("../ops/production/smoke-contract.json", import.meta.url);

async function readSmokeContract() {
  return JSON.parse(await readFile(smokeUrl, "utf8"));
}

test("production smoke contract keeps launch boundary fail closed", async () => {
  const contract = await readSmokeContract();

  assert.equal(contract.schema, "dashboard-rpi5.production-smoke.v1");
  assert.equal(contract.target.hostname, "dash.rozkalns.net");
  assert.equal(contract.target.loopbackWebHealthUrl, "http://127.0.0.1:8787/api/health");
  assert.equal(contract.local.webHealth.expectedStatus, 200);
  assert.equal(contract.local.webHealth.expectedService, "dashboard-rpi5-server");
  assert.equal(contract.local.agentHealth.transport, "unix-http");
  assert.equal(contract.local.agentHealth.socket, "/run/dashboard-rpi5/agent.sock");
  assert.equal(contract.local.agentHealth.path, "/v1/health");
  assert.equal(contract.public.unauthenticated.mustNotReachOriginContent, true);
  assert.deepEqual(contract.public.unauthenticated.acceptableAccessOutcome, [
    "ACCESS_CHALLENGE",
    "ACCESS_DENY",
  ]);
  assert.equal(contract.capabilityDefaults.quickCommands, "disabled");
  assert.equal(contract.capabilityDefaults.terminal, "disabled");
  assert.equal(contract.mobile.device, "Samsung Galaxy A55 5G");
  assert.equal(contract.mobile.pwaSmokeRequired, true);
  assert.equal(contract.evidence.recordExactProductionSha, true);
});

test("production smoke contract contains no mutation command surface", async () => {
  const raw = await readFile(smokeUrl, "utf8");
  for (const forbidden of [
    "systemctl",
    "docker restart",
    "docker stop",
    "sudo ",
    "cloudflared tunnel route",
    "useradd",
    "groupadd",
    "DASHBOARD_TERMINAL_ENABLED=enabled",
  ]) {
    assert.equal(raw.includes(forbidden), false, `smoke contract must not contain ${forbidden}`);
  }
});
