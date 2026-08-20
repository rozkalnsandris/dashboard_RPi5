import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(ROOT, path), "utf8");

const packageJson = JSON.parse(await read("package.json"));
const packageLock = JSON.parse(await read("package-lock.json"));
const hostContract = JSON.parse(await read("ops/production/host-readiness-contract.json"));
const brokerContract = JSON.parse(await read("ops/production/broker-readiness-contract.json"));
const nodeVersion = (await read(".node-version")).trim();
const workflow = await read(".github/workflows/ci.yml");
const brokerUnit = await read("ops/systemd/dashboard-rpi5-docker-broker.service");
const brokerEntry = await read("apps/agent/src/docker-broker-entry.ts");

test("Node v24 source contract stays lockfile-aligned while CI pins the reviewed runtime", () => {
  assert.equal(packageJson.engines.node, ">=24 <25");
  assert.equal(packageLock.packages[""].engines.node, packageJson.engines.node);
  assert.equal(hostContract.runtime.nodeMajor, 24);
  assert.equal(nodeVersion, "24.19.0");
  assert.equal((workflow.match(/node-version-file: \.node-version/gu) ?? []).length, 2);
  assert.doesNotMatch(workflow, /node-version:\s*24(?:\s|$)/u);
});

test("broker entry no longer depends on Node 24.2-only import.meta.main", () => {
  assert.doesNotMatch(brokerEntry, /import\.meta\.main/u);
  assert.match(brokerEntry, /fileURLToPath\(import\.meta\.url\)/u);
  assert.match(brokerEntry, /process\.argv\[1\]/u);
  assert.match(brokerEntry, /resolve\(process\.argv\[1\]\)/u);
  assert.match(brokerEntry, /invokedPath === fileURLToPath\(import\.meta\.url\)/u);
});

test("broker keeps Type=exec but active state is explicitly not application readiness", () => {
  assert.match(brokerUnit, /^Type=exec$/mu);
  assert.equal(brokerContract.systemdType, "exec");
  assert.equal(brokerContract.readinessModel, "application-probed");
  assert.equal(brokerContract.systemdActiveIsSufficient, false);
  assert.equal(brokerContract.notifySelected, false);
  assert.equal(brokerContract.socketActivationSelected, false);
});

test("broker readiness requires stable process, exact AF_UNIX socket and application probes", () => {
  assert.equal(brokerContract.runtime.stableMainPidRequired, true);
  assert.equal(brokerContract.runtime.stableNRestartsRequired, true);
  assert.equal(brokerContract.runtime.exactReleaseCwdRequired, true);
  assert.equal(brokerContract.runtime.socket, "/run/dashboard-rpi5-docker-broker/broker.sock");
  assert.equal(brokerContract.runtime.socketMode, "0660");
  assert.equal(brokerContract.applicationAcceptance.healthPath, "/v1/health");
  assert.equal(brokerContract.applicationAcceptance.dockerPath, "/v1/docker/containers");
  assert.deepEqual(brokerContract.applicationAcceptance.approvedLogPaths, [
    "/v1/docker/logs/homeassistant/15m",
    "/v1/docker/logs/prometheus/24h",
  ]);
  assert.equal(brokerContract.applicationAcceptance.requiredSuccessStatus, 200);
  assert.equal(brokerContract.applicationAcceptance.requiredFailClosedStatus, 404);
});

test("broker startup waits for listening before socket security and preserves authority boundaries", () => {
  const onError = brokerEntry.indexOf('server.once("error", onError)');
  const onListening = brokerEntry.indexOf('server.once("listening", onListening)');
  const listen = brokerEntry.indexOf("server.listen({");
  const secure = brokerEntry.indexOf("await secureSocketPath(socketPath)");
  assert.ok(onError >= 0 && onListening >= 0 && listen > onListening && secure > listen);
  assert.match(brokerEntry, /const onError = \(error: Error\) => \{[\s\S]*reject\(error\);/u);
  assert.match(brokerEntry, /const onListening = \(\) => \{[\s\S]*resolveListening\(\);/u);
  assert.equal(brokerContract.startupContract.listenEventRequiredBeforeSocketSecurity, true);
  assert.equal(brokerContract.startupContract.listenErrorFailsStartup, true);
  assert.equal(brokerContract.startupContract.boundedExternalReadinessProbeRequired, true);

  for (const key of [
    "mutationAllowed",
    "unitMutationAllowed",
    "identityMutationAllowed",
    "dockerAuthorityExpansionAllowed",
    "terminalMutationAllowed",
    "eventsMutationAllowed",
  ]) {
    assert.equal(brokerContract[key], false, key);
  }
  assert.match(brokerUnit, /^RestrictAddressFamilies=AF_UNIX$/mu);
  assert.doesNotMatch(brokerUnit, /^Type=notify$/mu);
  assert.doesNotMatch(brokerUnit, /NotifyAccess=/u);
});
