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
const brokerProtocol = await read("apps/agent/src/docker-broker-protocol.ts");
const agentEntry = await read("apps/agent/src/index.ts");
const cliEntry = await read("apps/agent/src/cli-entry.ts");

test("Node v24 source contract stays lockfile-aligned while CI pins the reviewed runtime", () => {
  assert.equal(packageJson.engines.node, ">=24 <25");
  assert.equal(packageLock.packages[""].engines.node, packageJson.engines.node);
  assert.equal(hostContract.runtime.nodeMajor, 24);
  assert.equal(nodeVersion, "24.19.0");
  assert.equal((workflow.match(/node-version-file: \.node-version/gu) ?? []).length, 2);
  assert.doesNotMatch(workflow, /node-version:\s*24(?:\s|$)/u);
});

test("production agent entrypoints use the shared symlink-safe CLI guard", () => {
  assert.doesNotMatch(brokerEntry, /import\.meta\.main/u);
  assert.doesNotMatch(agentEntry, /import\.meta\.main/u);
  assert.match(cliEntry, /moduleUrl: string = import\.meta\.url/u);
  assert.match(cliEntry, /process\.argv\[1\]/u);
  assert.match(cliEntry, /realpathSync\(invokedPath\)/u);
  assert.match(cliEntry, /realpathSync\(fileURLToPath\(moduleUrl\)\)/u);
  assert.match(brokerEntry, /import \{ isDirectCliInvocation \} from "\.\/cli-entry\.js";/u);
  assert.match(agentEntry, /import \{ isDirectCliInvocation \} from "\.\/cli-entry\.js";/u);
  assert.match(brokerEntry, /if \(isDirectCliInvocation\(\)\)/u);
  assert.match(agentEntry, /if \(isDirectCliInvocation\(\)\)/u);
});

test("post-P3 agent wiring preserves the accepted bounded Docker events reader", () => {
  assert.match(agentEntry, /readLiveRecentDockerEvents/u);
  assert.match(agentEntry, /dockerEventsReader: \(signal\) => readLiveRecentDockerEvents\(signal\)/u);
  assert.match(brokerProtocol, /DOCKER_BROKER_EVENTS_PATH = "\/v1\/docker\/events\/recent"/u);
  assert.match(brokerProtocol, /DOCKER_BROKER_EVENTS_MAX_WINDOW_SECONDS = 60 \* 60/u);
  assert.match(brokerProtocol, /DOCKER_BROKER_EVENTS_MAX_ITEMS = 512/u);
});

test("broker keeps Type=exec but active state is explicitly not application readiness", () => {
  assert.match(brokerUnit, /^Type=exec$/mu);
  assert.equal(brokerContract.systemdType, "exec");
  assert.equal(brokerContract.readinessModel, "application-probed");
  assert.equal(brokerContract.systemdActiveIsSufficient, false);
  assert.equal(brokerContract.notifySelected, false);
  assert.equal(brokerContract.socketActivationSelected, false);
});

test("broker readiness requires stable process, exact AF_UNIX socket and all accepted read probes", () => {
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
  assert.equal(brokerContract.applicationAcceptance.eventsPath, "/v1/docker/events/recent");
  assert.deepEqual(brokerContract.applicationAcceptance.eventsRequiredQuery, ["since", "until"]);
  assert.equal(brokerContract.applicationAcceptance.eventsMaxWindowSeconds, 3600);
  assert.equal(brokerContract.applicationAcceptance.eventsMaxItems, 512);
  assert.equal(brokerContract.applicationAcceptance.requiredSuccessStatus, 200);
  assert.deepEqual(brokerContract.applicationAcceptance.failClosedPaths, [
    "/v1/docker/logs/homeassistant/7d",
  ]);
  assert.equal(brokerContract.applicationAcceptance.requiredFailClosedStatus, 404);
});

test("broker startup waits for listening before socket security and preserves authority boundaries", () => {
  const onError = brokerEntry.indexOf('server.once("error", onError)');
  const onListening = brokerEntry.indexOf('server.once("listening", onListening)');
  const listen = brokerEntry.indexOf("server.listen({");
  const secure = brokerEntry.indexOf("await secureSocketPath(socketPath)");
  assert.ok(onError >= 0 && onListening >= 0 && listen > onListening && secure > listen);
  assert.match(brokerEntry, /const onError = \(error: Error\) => \{[\s\S]*reject\(error\);/u);
  assert.match(brokerEntry, /const onListening = \(\) => \{[\s\S]*resolve\(\);/u);
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
