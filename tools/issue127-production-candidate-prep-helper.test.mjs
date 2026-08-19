import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const helperUrl = new URL("./operator/issue127-production-candidate-prep.sh", import.meta.url);
const source = await readFile(helperUrl, "utf8");
const lines = source.split("\n").map((line) => line.trim());

test("#127 candidate prep helper has valid Bash syntax", () => {
  const result = spawnSync("bash", ["-n", fileURLToPath(helperUrl)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("#127 candidate prep helper is preparation-only", () => {
  assert.equal(source.includes("--apply"), false);

  const systemctlMutations = lines.filter((line) =>
    /^sudo\s+(?:\/usr\/bin\/)?systemctl\s+(restart|start|stop|enable|disable|reload|daemon-reload)\b/.test(
      line,
    ),
  );
  assert.deepEqual(systemctlMutations, []);

  for (const forbidden of [
    "/usr/sbin/groupadd",
    "/usr/sbin/useradd",
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
    "ln -s",
    "ln -sf",
    "mv ",
  ]) {
    assert.equal(source.includes(forbidden), false, `forbidden production mutation primitive: ${forbidden}`);
  }
});

test("#127 candidate prep binds exact merged main and discovers exact push CI", () => {
  assert.match(source, /TARGET="4295c23de5634dcb86b5fe9f57be92416eb9a75b"/);
  assert.match(source, /EXPECTED_CURRENT="15f44e3a6fdda8f2e97b26501a283f6bba915e86"/);
  assert.ok(source.includes("actions/runs?branch=main&event=push&per_page=100"));
  assert.ok(source.includes('select(.head_sha == $sha)'));
  assert.ok(source.includes('select(.event == "push")'));
  assert.ok(source.includes('select(.head_branch == "main")'));
  assert.ok(
    source.includes(
      "] | sort_by(.run_number, (.run_attempt // 1)) | last // empty\n')\" || blocked \"exact-main CI parse failed\"",
    ),
  );
  assert.equal(
    source.includes("\n+')\" || blocked \"exact-main CI parse failed\""),
    false,
  );
  assert.ok(source.includes("ISSUE127_EXACT_MAIN_CI_PASS"));
  for (const job of ["check", "terminal-native (x64)", "terminal-native (arm64)"]) {
    assert.ok(source.includes(job), `missing required CI job: ${job}`);
  }
});

test("#127 candidate prep proves current production baseline including active Quick Commands", () => {
  for (const required of [
    "EXPECTED_CURRENT_CANDIDATE=\"1d9c27a9c2ac2370bc626807e14c5786de58671b6547dfc2f5c822efa45e0a2e\"",
    "EXPECTED_BROKER_RELEASE=\"a53fb31c33d872ec4b434d5c999d5469e1989f14\"",
    "DASHBOARD_RPI5_QUICK_COMMANDS=enabled",
    "Quick Commands catalog not 200",
    "Docker logs should remain 503 before #127 activation",
    "Docker events should remain 503 pending #126",
    "old broker unexpectedly exposes #127 route",
    "terminal/PTTY runtime socket unexpectedly exists",
    "Access expected 302",
  ]) {
    assert.ok(source.includes(required), `missing production baseline assertion: ${required}`);
  }
});

test("#127 candidate prep pins bounded log authority", () => {
  for (const required of [
    "DOCKER_BROKER_LOG_MAX_RESPONSE_BYTES = 512 * 1024;",
    "DOCKER_BROKER_LOG_TAIL = 400;",
    'DOCKER_BROKER_LOG_SOURCES = ["homeassistant", "prometheus"] as const;',
    'DOCKER_BROKER_LOG_RANGES = ["15m", "1h", "6h", "24h"] as const;',
    'homeassistant: "homeassistant"',
    'prometheus: "prometheus"',
    "stdout=true&stderr=true&since=${sinceSeconds}&timestamps=true&tail=${DOCKER_BROKER_LOG_TAIL}",
    '"docker:homeassistant"',
    '"docker:prometheus"',
    "ISSUE127_SOURCE_CONTRACT_PASS",
  ]) {
    assert.ok(source.includes(required), `missing bounded log contract: ${required}`);
  }
});

test("#127 candidate prep uses a fresh operator cache and builds a verified immutable candidate", () => {
  for (const required of [
    'WORKSPACE="$HOME/.cache/dashboard-rpi5-candidate-prep/${TARGET}-issue127"',
    "workspace exists; no auto-reuse/cleanup",
    "npm ci --ignore-scripts",
    "npm audit --audit-level=high",
    "npm run check",
    "production-candidate-manifest.mjs",
    "ISSUE127_CANDIDATE_VERIFY_PASS",
    "production-runtime-smoke.mjs",
    "ISSUE127_RUNTIME_SMOKE_PASS",
    "production-release-controller.mjs",
    "ISSUE127_RELEASE_PLAN_PASS",
    "copy_manifest_allowlisted_release",
    "write_verified_manifest_marker",
    "atomic_current_symlink_swap",
  ]) {
    assert.ok(source.includes(required), `missing candidate preparation gate: ${required}`);
  }
});

test("#127 candidate prep re-proves no production change and stops", () => {
  const reproof = source.indexOf("# 8. Re-prove there was no production/trust-boundary change during preparation.");
  const ready = source.indexOf("ISSUE127_CANDIDATE_PREPARATION_READY");
  const stop = source.indexOf("ISSUE127_CANDIDATE_PREP_STOP");
  assert.ok(reproof >= 0);
  assert.ok(ready > reproof);
  assert.ok(stop > ready);

  for (const required of [
    "current pointer changed during prep",
    "target release appeared during prep",
    "broker PID changed during prep",
    "agent PID changed during prep",
    "web PID changed during prep",
    "Docker logs changed during prep",
    "Quick Commands changed during prep",
    "production_mutation=NO",
    "release_apply=NO",
    "systemd_mutation=NO",
    "identity_mutation=NO",
    "permission_mutation=NO",
    "broker_restart=NO",
    "agent_restart=NO",
    "web_restart=NO",
    "cloudflare=UNCHANGED",
  ]) {
    assert.ok(source.includes(required), `missing no-mutation proof: ${required}`);
  }
});
