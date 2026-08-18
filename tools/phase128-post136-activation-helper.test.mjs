import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const helperUrl = new URL(
  "./operator/phase128-post136-production-activate.sh",
  import.meta.url,
);
const helperPath = fileURLToPath(helperUrl);
const source = await readFile(helperUrl, "utf8");
const lines = source.split("\n").map((line) => line.trim());

test("post-#136 activation helper has valid bash syntax", () => {
  const result = spawnSync("bash", ["-n", helperPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("post-#136 activation helper binds exact source, candidate and incident baseline", () => {
  for (const required of [
    'TARGET="15f44e3a6fdda8f2e97b26501a283f6bba915e86"',
    'EXPECTED_CURRENT="a53fb31c33d872ec4b434d5c999d5469e1989f14"',
    'EXPECTED_CURRENT_CANDIDATE="73c531ab3023e7072dddf60361c77f759ab675e64652932180ef4fc21e257b32"',
    'OLD_WEB_RELEASE="73c51f3446395c51ea010831c4614777264fae3e"',
    'EXPECTED_CI_RUN="305"',
    'EXPECTED_CI_RUN_ID="32177354491"',
    'EXPECTED_CANDIDATE="1d9c27a9c2ac2370bc626807e14c5786de58671b6547dfc2f5c822efa45e0a2e"',
    'EXPECTED_MANIFEST_SHA="2cc46ad30787355eead24aab90d769cd8cf984fcc8d811ae637939b83abddaf7"',
    'EXPECTED_BROKER_PID="1760676"',
    'EXPECTED_AGENT_PID="1913117"',
    'EXPECTED_WEB_PID="359766"',
    'EXPECTED_AGENT_ENTRY_SHA="9b533fc0850fce23f95943f6d53a64b776d94f2c6a48c2327afdca88e5a9e0e0"',
    'EXPECTED_SERVER_ENTRY_SHA="48507348b12cb54693e3c5a790460afb5b400b9a3400f2751b509700c6e33778"',
  ]) {
    assert.ok(source.includes(required), `missing exact binding: ${required}`);
  }
});

test("preflight-only mode exits before the mutation boundary", () => {
  const preflightMode = source.indexOf('MODE="preflight"');
  const preflightStop = source.indexOf("PHASE128_POST136_PREFLIGHT_ONLY_STOP");
  const mutationStarted = source.indexOf('MUTATION_STARTED="YES"');
  const releaseApply = source.indexOf("--expected-current \"$EXPECTED_CURRENT\" --apply");

  assert.ok(preflightMode >= 0);
  assert.ok(preflightStop > preflightMode);
  assert.ok(mutationStarted > preflightStop);
  assert.ok(releaseApply > mutationStarted);
});

test("activation helper has exactly the reviewed production mutation surface", () => {
  const restartCommands = lines.filter((line) =>
    line.startsWith("sudo /usr/bin/systemctl restart "),
  );
  assert.deepEqual(restartCommands, [
    'sudo /usr/bin/systemctl restart "$AGENT_SERVICE" || stop "agent restart command failed"',
    'sudo /usr/bin/systemctl restart "$WEB_SERVICE" || stop "web restart command failed"',
  ]);

  assert.equal(
    lines.filter((line) =>
      line.includes('--expected-current "$EXPECTED_CURRENT" --apply'),
    ).length,
    1,
  );

  for (const forbidden of [
    'systemctl restart "$BROKER_SERVICE"',
    "systemctl daemon-reload",
    "systemctl enable",
    "systemctl disable",
    "systemctl start",
    "systemctl stop",
    "/usr/sbin/groupadd",
    "/usr/sbin/useradd",
    "/usr/bin/install ",
    "usermod ",
    "gpasswd ",
    "chmod ",
    "chown ",
    "--rollback",
    "production-release-controller.mjs --rollback",
    "cloudflared tunnel",
    "rm -",
    "unlink ",
    "rmdir ",
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `activation helper must not contain forbidden primitive: ${forbidden}`,
    );
  }
});

test("release activation is the first production mutation and web follows agent acceptance", () => {
  const mutationBoundary = source.indexOf("PHASE128_POST136_MUTATION_STARTED");
  const releaseApply = source.indexOf("--expected-current \"$EXPECTED_CURRENT\" --apply");
  const agentRestart = source.indexOf(
    'sudo /usr/bin/systemctl restart "$AGENT_SERVICE"',
  );
  const agentPass = source.indexOf("PHASE128_POST136_AGENT_PASS");
  const webRestart = source.indexOf(
    'sudo /usr/bin/systemctl restart "$WEB_SERVICE"',
  );
  const finalPass = source.indexOf("PHASE128_POST136_FINAL");

  assert.ok(mutationBoundary >= 0);
  assert.ok(releaseApply > mutationBoundary);
  assert.ok(agentRestart > releaseApply);
  assert.ok(agentPass > agentRestart);
  assert.ok(webRestart > agentPass);
  assert.ok(finalPass > webRestart);
});

test("activation helper preserves the already-running broker", () => {
  for (const required of [
    "running-release broker entry is not byte-identical to target broker entry",
    "broker PID changed during release activation",
    "broker cwd changed during release activation",
    "broker PID changed during agent cutover",
    "broker restarted during agent cutover",
    "final broker PID drift",
    "final broker restart count drift",
    "bounded_docker_broker=PRESERVED",
    "broker_restart=NO",
  ]) {
    assert.ok(source.includes(required), `missing broker-preservation assertion: ${required}`);
  }
});

test("source-fixed Docker acceptance is mandatory before web restart", () => {
  for (const required of [
    "A53 agent Docker is no longer exact 504 pre-fix state",
    '.error == "OPERATION_TIMEOUT"',
    "source-fixed Docker current-state not 200",
    '(.apiVersion == "1.40")',
    "source-fixed Docker payload invalid or empty",
    "web Docker current-state not 200",
    "web Docker payload invalid or empty",
  ]) {
    assert.ok(source.includes(required), `missing Docker acceptance gate: ${required}`);
  }
});

test("security and fail-closed capabilities remain unchanged throughout activation", () => {
  for (const required of [
    "main agent persistent group boundary violated",
    "agent process unexpectedly has Docker group",
    "agent process unexpectedly has video group",
    "new agent unexpectedly has Docker group",
    "new agent unexpectedly has video group",
    "Docker events should remain 503 pending #126",
    "Docker logs should remain 503 pending #127",
    "Quick Commands changed after agent cutover",
    "terminal runtime socket appeared",
    "Access changed after agent cutover",
    "Docker events not 503 at final proof",
    "Docker logs not 503 at final proof",
    "Quick Commands not 404 at final proof",
    "terminal runtime socket present at final proof",
    "final Access not 302",
    "main_agent_docker_group=NO",
    "main_agent_video_group=NO",
    "cloudflare=UNCHANGED",
    "public_launch=YES_ACCESS_PROTECTED",
  ]) {
    assert.ok(source.includes(required), `missing final boundary: ${required}`);
  }
});

test("post-mutation failure is explicitly terminal and consuming", () => {
  for (const required of [
    "MUTATION_STARTED=YES AUTHORIZATION_CONSUMED=YES",
    "AUTO_RETRY=NO",
    "AUTO_ROLLBACK=NO",
    "AUTO_CLEANUP=NO",
    "BROKER_RESTART=NO",
    "SYSTEMD_UNIT_MUTATION=NO",
    "IDENTITY_MUTATION=NO",
    "PERMISSION_MUTATION=NO",
    "CLOUDFLARE_MUTATION=NO",
  ]) {
    assert.ok(source.includes(required), `missing STOP contract: ${required}`);
  }
});
