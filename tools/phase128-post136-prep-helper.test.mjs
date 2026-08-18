import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const helperUrl = new URL(
  "./operator/phase128-post136-production-prep.sh",
  import.meta.url,
);
const source = await readFile(helperUrl, "utf8");
const lines = source.split("\n").map((line) => line.trim());

test("post-#136 prep helper has valid Bash syntax", () => {
  const result = spawnSync("bash", ["-n", fileURLToPath(helperUrl)], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("post-#136 prep helper is preparation-only", () => {
  assert.equal(source.includes("--apply"), false);

  const systemctlMutations = lines.filter((line) =>
    /^sudo\s+\/usr\/bin\/systemctl\s+(restart|start|stop|enable|disable|reload|daemon-reload)\b/.test(
      line,
    ),
  );
  assert.deepEqual(systemctlMutations, []);

  for (const forbidden of [
    "/usr/sbin/groupadd",
    "/usr/sbin/useradd",
    "/usr/bin/install ",
    "systemctl restart",
    "systemctl start",
    "systemctl stop",
    "systemctl enable",
    "systemctl disable",
    "systemctl daemon-reload",
    "usermod ",
    "gpasswd ",
    "chmod ",
    "chown ",
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `prep helper must not contain production mutation primitive: ${forbidden}`,
    );
  }
});

test("post-#136 prep helper binds exact merged main and exact-main CI", () => {
  assert.match(
    source,
    /TARGET="15f44e3a6fdda8f2e97b26501a283f6bba915e86"/,
  );
  assert.match(
    source,
    /EXPECTED_CURRENT="a53fb31c33d872ec4b434d5c999d5469e1989f14"/,
  );
  assert.match(
    source,
    /OLD_WEB_RELEASE="73c51f3446395c51ea010831c4614777264fae3e"/,
  );
  assert.match(source, /EXPECTED_CI_RUN="305"/);
  assert.match(source, /EXPECTED_CI_RUN_ID="32177354491"/);
  assert.ok(source.includes("GITHUB_EXACT_MAIN_CI_PASS"));
});

test("post-#136 prep helper proves the stopped partial runtime before building", () => {
  for (const required of [
    '[ "$broker_cwd" = "$CURRENT_RELEASE" ]',
    '[ "$agent_cwd" = "$CURRENT_RELEASE" ]',
    '[ "$web_cwd" = "$OLD_WEB_RELEASE_PATH" ]',
    "A53 agent Docker must remain 504 before source-fixed activation",
    ".error == \"OPERATION_TIMEOUT\"",
    "broker containers not 200",
    "Docker events should remain 503 pending #126",
    "Docker logs should remain 503 pending #127",
    "Quick Commands not 404",
    "terminal runtime socket exists",
    "Access expected 302",
  ]) {
    assert.ok(source.includes(required), `missing partial-state assertion: ${required}`);
  }
});

test("post-#136 prep helper pins the merged timeout contract", () => {
  for (const required of [
    "export const DOCKER_CONTAINER_CONCURRENCY = 8;",
    "export const DOCKER_CONTAINERS_OPERATION_TIMEOUT_MS = 8_000;",
    "export const DEFAULT_OPERATION_TIMEOUT_MS = 5_000;",
    "export const AGENT_CURRENT_STATE_TIMEOUT_MS = 1_500;",
    "export const AGENT_DOCKER_CURRENT_STATE_TIMEOUT_MS = 10_000;",
    "SOURCE_FIXED_CONTRACT_PASS",
  ]) {
    assert.ok(source.includes(required), `missing source-fixed contract: ${required}`);
  }
});

test("post-#136 prep helper prepares a fresh immutable candidate and PLAN only", () => {
  for (const required of [
    'WORKSPACE="$HOME/.cache/dashboard-rpi5-candidate-prep/${TARGET}-post136"',
    "workspace exists; no auto-reuse/cleanup",
    "npm ci --ignore-scripts",
    "npm audit --audit-level=high",
    "npm run check",
    "production-candidate-manifest.mjs",
    "CANDIDATE_VERIFY_PASS",
    "production-runtime-smoke.mjs",
    "RUNTIME_SMOKE_PASS",
    "production-release-controller.mjs",
    "RELEASE_PLAN_PASS",
    "copy_manifest_allowlisted_release",
    "write_verified_manifest_marker",
    "atomic_current_symlink_swap",
  ]) {
    assert.ok(source.includes(required), `missing preparation gate: ${required}`);
  }
});

test("post-#136 prep helper re-proves no production or trust-boundary change", () => {
  const reproof = source.indexOf(
    "# 8. Re-prove production and trust boundaries did not change during preparation.",
  );
  const finalReady = source.indexOf("PHASE128_POST136_PREPARATION_READY");
  const finalStop = source.indexOf("PHASE128_POST136_STOP");

  assert.ok(reproof >= 0);
  assert.ok(finalReady > reproof);
  assert.ok(finalStop > finalReady);

  for (const required of [
    "current changed during prep",
    "target release appeared during prep",
    "broker PID changed",
    "agent PID changed",
    "web PID changed",
    "broker state changed during prep",
    "A53 agent Docker state changed during prep",
    "Quick Commands changed during prep",
    "Docker events changed during prep",
    "Docker logs changed during prep",
    "terminal runtime socket appeared during prep",
    "agent persistent group changed during prep",
    "broker persistent group changed during prep",
    "web persistent group changed during prep",
    "post-prep Access expected 302",
    "production_mutation=NO",
    "release_apply=NO",
    "broker_restart=NO",
    "agent_restart=NO",
    "web_restart=NO",
  ]) {
    assert.ok(source.includes(required), `missing final no-mutation proof: ${required}`);
  }
});
