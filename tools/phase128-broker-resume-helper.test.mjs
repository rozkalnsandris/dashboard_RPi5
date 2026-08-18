import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helperUrl = new URL(
  "./operator/phase128-broker-production-resume-a53.sh",
  import.meta.url,
);
const source = await readFile(helperUrl, "utf8");

const lines = source.split("\n").map((line) => line.trim());

test("Phase 128 resume helper has exactly two production mutation commands", () => {
  const sudoSystemctlMutations = lines.filter((line) =>
    line.startsWith("sudo /usr/bin/systemctl "),
  );

  assert.deepEqual(sudoSystemctlMutations, [
    'sudo /usr/bin/systemctl restart "$AGENT_SERVICE" || stop "agent restart command failed"',
    'sudo /usr/bin/systemctl restart "$WEB_SERVICE" || stop "web restart command failed"',
  ]);
});

test("Phase 128 resume helper excludes activation and cleanup mutation primitives", () => {
  for (const forbidden of [
    "/usr/sbin/groupadd",
    "/usr/sbin/useradd",
    "production-release-controller.mjs",
    "/usr/bin/install",
    "systemctl daemon-reload",
    "systemctl enable",
    "systemctl start",
    "systemctl stop",
    "systemctl disable",
    "systemctl reload",
    "systemctl restart \"$BROKER_SERVICE\"",
    "rm -",
    "unlink ",
    "rmdir ",
    "chmod ",
    "chown ",
    "usermod ",
    "gpasswd ",
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `resume helper must not contain forbidden mutation primitive: ${forbidden}`,
    );
  }
});

test("Phase 128 resume helper binds exact incident state and a new owner acknowledgement", () => {
  assert.match(
    source,
    /TARGET="a53fb31c33d872ec4b434d5c999d5469e1989f14"/,
  );
  assert.match(
    source,
    /EXPECTED_CANDIDATE="73c531ab3023e7072dddf60361c77f759ab675e64652932180ef4fc21e257b32"/,
  );
  assert.match(source, /EXPECTED_BROKER_PID="1760676"/);
  assert.match(source, /EXPECTED_AGENT_PID="359674"/);
  assert.match(source, /EXPECTED_WEB_PID="359766"/);
  assert.match(
    source,
    /EXPECTED_OWNER_ACK="I_AUTHORIZE_PHASE128_A53_RESUME_AGENT_WEB_CUTOVER_73C531AB"/,
  );
});

test("Phase 128 resume orders web restart only after full agent acceptance", () => {
  const mutationBoundary = source.indexOf(
    'PHASE128_A53_RESUME_MUTATION_BOUNDARY next=restart-agent',
  );
  const agentRestart = source.indexOf(
    'sudo /usr/bin/systemctl restart "$AGENT_SERVICE"',
  );
  const agentPass = source.indexOf("PHASE128_A53_AGENT_RESUME_PASS");
  const webRestart = source.indexOf(
    'sudo /usr/bin/systemctl restart "$WEB_SERVICE"',
  );
  const finalPass = source.indexOf("PHASE128_A53_RESUME_FINAL");

  assert.ok(mutationBoundary >= 0);
  assert.ok(agentRestart > mutationBoundary);
  assert.ok(agentPass > agentRestart);
  assert.ok(webRestart > agentPass);
  assert.ok(finalPass > webRestart);
});

test("Phase 128 resume keeps key trust boundaries fail closed", () => {
  for (const required of [
    'proc_has_gid "$new_agent_pid" "$broker_gid"',
    'proc_has_gid "$new_agent_pid" "$docker_gid"',
    'proc_has_gid "$new_agent_pid" "$video_gid"',
    "Docker events should remain 503 pending #126",
    "Docker logs should remain 503 pending #127",
    "Quick Commands changed after agent resume",
    "terminal runtime socket appeared",
    "Access changed after agent resume",
    'proc_has_gid "$new_web_pid" "$broker_gid"',
    'proc_has_gid "$new_web_pid" "$docker_gid"',
    'proc_has_gid "$new_web_pid" "$video_gid"',
    "broker PID changed during agent resume",
    "broker restarted during agent resume",
  ]) {
    assert.ok(source.includes(required), `missing trust-boundary assertion: ${required}`);
  }
});
