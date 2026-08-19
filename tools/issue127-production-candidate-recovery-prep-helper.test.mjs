import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { URL } from "node:url";

const helperPath = new URL("./operator/issue127-production-candidate-recovery-prep.sh", import.meta.url);
const source = readFileSync(helperPath, "utf8");

const TARGET = "4295c23de5634dcb86b5fe9f57be92416eb9a75b";
const TREE = "df24c7e8e2047176c43f24989e4910a30fa1bc02";
const RUN_ID = "32278079231";
const RUN_NUMBER = "318";
const RUN_ATTEMPT = "2";
const CHECK_JOB_ID = "96174756688";

test("recovery helper is valid bash", () => {
  const result = spawnSync("bash", ["-n", helperPath.pathname], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("recovery helper binds exact merged main and exact recovered CI attempt", () => {
  assert.match(source, new RegExp(`TARGET="${TARGET}"`));
  assert.match(source, new RegExp(`EXPECTED_TREE="${TREE}"`));
  assert.match(source, new RegExp(`EXPECTED_CI_RUN_ID="${RUN_ID}"`));
  assert.match(source, new RegExp(`EXPECTED_CI_RUN_NUMBER="${RUN_NUMBER}"`));
  assert.match(source, new RegExp(`EXPECTED_CI_RUN_ATTEMPT="${RUN_ATTEMPT}"`));
  assert.match(source, new RegExp(`EXPECTED_CHECK_JOB_ID="${CHECK_JOB_ID}"`));
  assert.match(source, /actions\/runs\/\$EXPECTED_CI_RUN_ID/);
  assert.match(source, /\.run_attempt/);
  assert.match(source, /\.head_sha/);
  assert.match(source, /\.event/);
  assert.match(source, /\.head_branch/);
  assert.match(source, /\.conclusion/);
  assert.match(source, /jobs\?filter=latest&per_page=100/);
  assert.match(source, /Install Chromium/);
  assert.match(source, /Responsive browser tests/);
  assert.match(source, /terminal-native \(x64\)/);
  assert.match(source, /terminal-native \(arm64\)/);
});

test("recovery helper uses a new workspace and never reuses the failed #147 workspace", () => {
  assert.match(source, /WORKSPACE_ROOT="\$HOME\/\.cache\/dashboard-rpi5-candidate-recovery"/);
  assert.match(source, /issue127-ci318-a2/);
  assert.doesNotMatch(source, /dashboard-rpi5-candidate-prep\//);
  assert.doesNotMatch(source, /issue127-production-candidate-prep\.sh/);
  assert.match(source, /recovery workspace exists; no auto-reuse\/cleanup/);
  assert.match(source, /OLD_WORKSPACE_REUSE=NO/);
  assert.match(source, /old_workspace_reuse=NO/);
});

test("recovery helper stays preparation-only and has no Actions retry or production mutation command", () => {
  assert.doesNotMatch(source, /--apply\b/);
  assert.doesNotMatch(source, /^\s*systemctl\s+(?:start|stop|restart|reload|enable|disable|daemon-reload)\b/m);
  assert.doesNotMatch(source, /\b(?:useradd|usermod|userdel|groupadd|groupmod|groupdel|gpasswd|chmod|chown)\b/);
  assert.doesNotMatch(source, /\brm\s+-rf\b/);
  assert.doesNotMatch(source, /\bunlink\b/);
  assert.doesNotMatch(source, /\bln\s+-s\b/);
  assert.doesNotMatch(source, /-X\s+(?:POST|PUT|PATCH|DELETE)\b/);
  assert.doesNotMatch(source, /actions\/runs\/[^\s"']+\/(?:rerun|cancel)/);
  assert.match(source, /production-release-controller\.mjs/);
  assert.match(source, /\.status'\)" = PLAN/);
  assert.match(source, /PRODUCTION_MUTATION=NO/);
  assert.match(source, /RELEASE_APPLY=NO/);
  assert.match(source, /ACTIONS_RERUN=NO/);
  assert.match(source, /SYSTEMD_MUTATION=NO/);
  assert.match(source, /IDENTITY_MUTATION=NO/);
  assert.match(source, /PERMISSION_MUTATION=NO/);
  assert.match(source, /CLOUDFLARE_MUTATION=NO/);
  assert.match(source, /SERVICE_RESTART=NO/);
  assert.match(source, /AUTO_RETRY=NO/);
  assert.match(source, /AUTO_CLEANUP=NO/);
});

test("recovery helper pins #127 bounded Docker log contract and preserved production boundaries", () => {
  assert.match(source, /DOCKER_BROKER_LOG_MAX_RESPONSE_BYTES = 512 \* 1024/);
  assert.match(source, /DOCKER_BROKER_LOG_TAIL = 400/);
  assert.match(source, /DOCKER_BROKER_LOG_SOURCES = \["homeassistant", "prometheus"\]/);
  assert.match(source, /DOCKER_BROKER_LOG_RANGES = \["15m", "1h", "6h", "24h"\]/);
  assert.match(source, /stdout=true&stderr=true&since=\$\{sinceSeconds\}&timestamps=true&tail=\$\{DOCKER_BROKER_LOG_TAIL\}/);
  assert.match(source, /Docker logs should remain 503 before #127 activation/);
  assert.match(source, /Docker events should remain 503 pending #126/);
  assert.match(source, /DASHBOARD_RPI5_QUICK_COMMANDS=enabled/);
  assert.match(source, /host\.disk-root/);
  assert.match(source, /host\.failed-units/);
  assert.match(source, /host\.kernel/);
  assert.match(source, /host\.uptime/);
  assert.match(source, /terminal\/PTTY runtime socket unexpectedly exists/);
  assert.match(source, /ISSUE127_ACCESS_CODE:302/);
});

test("recovery helper prepares and verifies a fresh candidate then stops", () => {
  assert.match(source, /npm ci --ignore-scripts/);
  assert.match(source, /npm audit --audit-level=high/);
  assert.match(source, /npm run check/);
  assert.match(source, /production-candidate-manifest\.mjs/);
  assert.match(source, /production-runtime-smoke\.mjs/);
  assert.match(source, /ISSUE127_RECOVERY_CANDIDATE_VERIFY_PASS/);
  assert.match(source, /ISSUE127_RECOVERY_RUNTIME_SMOKE_PASS/);
  assert.match(source, /ISSUE127_RECOVERY_RELEASE_PLAN_PASS/);
  assert.match(source, /ISSUE127_RECOVERY_CANDIDATE_PREPARATION_READY/);
  assert.match(source, /ISSUE127_RECOVERY_PREP_STOP/);
});
