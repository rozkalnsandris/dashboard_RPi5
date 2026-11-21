import assert from "node:assert/strict";
import test from "node:test";
import { loadNativeReleaseEvidence, validateNativeReleaseEvidence } from "./native-release-profile.mjs";

const baseline = await loadNativeReleaseEvidence();
test("source profile coheres with reviewed native release, web unit, and manifest", () => {
  assert.deepStrictEqual(validateNativeReleaseEvidence(baseline), {
    status: "SOURCE_ONLY_PROFILE_VALID",
    schema: "dashboard-rpi5.native-release-profile.v1",
    automaticDeploy: false,
    liveMutation: false,
  });
});
const cases = [
  ["extra undeclared authority", (e) => { e.profile.unsafe = true; }],
  ["Docker/Compose substitution", (e) => { e.profile.runtime.compose = true; }],
  ["automatic deploy", (e) => { e.profile.gates.automaticDeploy = true; }],
  ["merge equals LIVE", (e) => { e.profile.gates.mergeAuthorizesLive = true; }],
  ["per-release gate bypass", (e) => { e.profile.gates.ownerLiveEveryRelease = false; }],
  ["restart gate bypass", (e) => { e.profile.gates.ownerLiveForRestart = false; }],
  ["candidate code granted root", (e) => { e.profile.gates.runCandidateControllerAsRoot = true; }],
  ["automatic retry", (e) => { e.profile.gates.automaticRetry = true; }],
  ["automatic rollback", (e) => { e.profile.gates.automaticRollback = true; }],
  ["automatic cleanup", (e) => { e.profile.gates.automaticCleanup = true; }],
  ["Docker group escalation", (e) => { e.webUnit = e.webUnit.replace(
    "SupplementaryGroups=dashboard-rpi5-agent-client",
    "SupplementaryGroups=dashboard-rpi5-agent-client docker",
  ); }],
  ["root web service", (e) => { e.webUnit = e.webUnit.replace(
    "User=dashboard-rpi5-web", "User=root",
  ); }],
  ["unreviewed web executable", (e) => { e.webUnit = e.webUnit.replace(
    "ExecStart=/usr/bin/node /opt/dashboard_RPi5/current/apps/server/dist/index.js",
    "ExecStart=/usr/bin/docker run dashboard",
  ); }],
  ["wrong agent socket", (e) => { e.launch.web.agentSocket = "/run/unknown.sock"; }],
  ["mutable release identity", (e) => { e.activation.releaseDirectory = "latest"; }],
  ["untrusted release ownership", (e) => { e.activation.releaseMetadata.owner = "web"; }],
  ["no current gate", (e) => { e.activation.applyGate.requiresExpectedCurrent = false; }],
  ["no candidate digest gate", (e) => { e.activation.applyGate.requiresExpectedCandidateSha256 = false; }],
  ["stale lock auto cleanup", (e) => { e.activation.staleLockAutoCleanup = true; }],
  ["missing Docker broker closure", (e) => { e.files = e.files.filter(
    (p) => p !== "ops/systemd/dashboard-rpi5-docker-broker.service",
  ); }],
  ["missing native terminal closure", (e) => { e.dirs = e.dirs.filter(
    (p) => p !== "apps/terminal-agent/dist",
  ); }],
];
for (const [description, change] of cases) {
  test(`fail closed: ${description}`, () => {
    const evidence = JSON.parse(JSON.stringify(baseline));
    change(evidence);
    assert.throws(() => validateNativeReleaseEvidence(evidence));
  });
}
