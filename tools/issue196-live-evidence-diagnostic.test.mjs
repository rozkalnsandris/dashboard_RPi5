import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import test from "node:test";
import assert from "node:assert/strict";

const helperPath = resolve("tools/operator/issue196-live-evidence-diagnostic.sh");
const helper = await readFile(helperPath, "utf8");
const secondPassHelperPath = resolve("tools/operator/issue196-second-pass-read-only-preflight.sh");
const secondPassHelper = await readFile(secondPassHelperPath, "utf8");
const issue226PreflightPath = resolve("tools/operator/issue226-readonly-recovery-preflight.sh");
const issue226Preflight = await readFile(issue226PreflightPath, "utf8");
const agentApp = await readFile(resolve("apps/agent/src/app.ts"), "utf8");
const liveShell = await readFile(resolve("apps/web/src/LiveShell.tsx"), "utf8");
const webMain = await readFile(resolve("apps/web/src/main.tsx"), "utf8");

test("issue196 diagnostic helper is valid bash", () => {
  execFileSync("bash", ["-n", helperPath], { stdio: "pipe" });
});

test("issue196 second-pass preflight is valid bash", () => {
  execFileSync("bash", ["-n", secondPassHelperPath], { stdio: "pipe" });
});

test("issue226 recovery preflight is valid bash", () => {
  execFileSync("bash", ["-n", issue226PreflightPath], { stdio: "pipe" });
});

test("issue196 helper is fixed to loopback and reviewed evidence paths", () => {
  assert.match(helper, /WEB_BASE='http:\/\/127\.0\.0\.1:8787'/u);
  assert.match(helper, /PROMETHEUS_BASE='http:\/\/127\.0\.0\.1:9090'/u);
  assert.match(helper, /\/var\/lib\/dashboard-rpi5\/evidence\/backups\.json/u);
  assert.match(helper, /\/var\/lib\/dashboard-rpi5\/evidence\/endpoints\.json/u);
  assert.match(helper, /\/var\/log\/rpi5-backup\.log/u);
  assert.match(helper, /\/etc\/dashboard-rpi5\/web\.env/u);
  assert.match(helper, /\/dev\/vcio/u);
  assert.doesNotMatch(helper, /DASHBOARD_ISSUE196_.*BASE/u);
});

test("issue196 helper reports device metadata without treating vcio as a regular file", () => {
  assert.match(helper, /print_path_metadata VCIO_DEVICE '\/dev\/vcio'/u);
  assert.doesNotMatch(helper, /print_file_state VCIO_DEVICE/u);
  assert.match(helper, /stat -Lc '%F:%u:%g:%a'/u);
});

test("issue196 helper checks every confirmed live read-only failure cluster", () => {
  for (const token of [
    "HOST_HTTP",
    "DOCKER_HTTP",
    "SERVICES_HTTP",
    "HISTORY_24H_HTTP",
    "LOG_SOURCES_HTTP",
    "LOG_MAINTENANCE_HTTP",
    "LOG_DOCKER_PROMETHEUS_HTTP",
    "BACKUPS_HTTP",
    "ENDPOINTS_HTTP",
    "DEPLOYMENTS_HTTP",
    "PROMETHEUS_READY_HTTP",
    "PROMETHEUS_NODE_LOAD_SERIES",
    "SERVICES_OBSERVED_AGE_SECONDS",
    "DOCKER_RUNNING_STATS_UNAVAILABLE",
    "VCIO_DEVICE",
    "AGENT_VIDEO_GROUP",
    "AGENT_JOURNAL_READ_GROUP",
  ]) {
    assert.ok(helper.includes(token), `missing diagnostic token: ${token}`);
  }
});

test("issue196 helper never reads secret-bearing file contents", () => {
  assert.doesNotMatch(helper, /cat\s+[^\n]*(web\.env|cloudflare|token|secret)/u);
  assert.doesNotMatch(helper, /source\s+[^\n]*web\.env/u);
  assert.doesNotMatch(helper, /\.\s+[^\n]*web\.env/u);
  assert.doesNotMatch(helper, /Authorization:/u);
});

test("issue196 helper is read-only and contains no mutation or retry path", () => {
  assert.doesNotMatch(helper, /\bsudo\b/u);
  assert.doesNotMatch(helper, /systemctl\s+(start|stop|restart|reload|enable|disable|daemon-reload)/u);
  assert.doesNotMatch(helper, /\b(chmod|chown|usermod|useradd|groupadd|install|tee|truncate|touch|mkdir|rm|mv|cp)\b/u);
  assert.doesNotMatch(helper, /cloudflared/u);
  assert.doesNotMatch(helper, /curl[^\n]*(--request|-X)\s*(POST|PUT|PATCH|DELETE)/u);
  assert.match(helper, /PRODUCTION_MUTATION=NO/u);
  assert.match(helper, /SYSTEMD_MUTATION=NO/u);
  assert.match(helper, /IDENTITY_PERMISSION_MUTATION=NO/u);
  assert.match(helper, /DOCKER_AUTHORITY_MUTATION=NO/u);
  assert.match(helper, /CLOUDFLARE_MUTATION=NO/u);
  assert.match(helper, /TERMINAL_ACTIVATION=NO/u);
});

test("issue196 second-pass preflight is bounded and read-only", () => {
  assert.match(secondPassHelper, /WEB_BASE='http:\/\/127\.0\.0\.1:8787'/u);
  assert.match(secondPassHelper, /docker port "\$PROMETHEUS_CONTAINER" 9090\/tcp/u);
  assert.match(secondPassHelper, /docker stats --no-stream/u);
  assert.match(secondPassHelper, /journalctl --no-pager/u);
  assert.match(secondPassHelper, /stat -Lc '%F:%U:%G:%a' \/dev\/vcio/u);
  assert.match(secondPassHelper, /VCGENCMD_OPERATOR_RESULT/u);
  assert.match(secondPassHelper, /JOURNAL_RPI5_DEPLOY_VISIBLE/u);
  assert.match(secondPassHelper, /JOURNAL_RPI5_MONITOR_VISIBLE/u);
  assert.match(secondPassHelper, /DOCKER_DIRECT_STATS_DURATION_MS/u);
  assert.doesNotMatch(secondPassHelper, /\bsudo\b/u);
  assert.doesNotMatch(secondPassHelper, /docker\s+(exec|inspect|restart|stop|start|rm|kill|update|run)\b/u);
  assert.doesNotMatch(secondPassHelper, /systemctl\s+(start|stop|restart|reload|enable|disable|daemon-reload)/u);
  assert.doesNotMatch(secondPassHelper, /\b(chmod|chown|usermod|useradd|groupadd|install|tee|truncate|touch|mkdir|rm|mv|cp)\b/u);
  assert.doesNotMatch(secondPassHelper, /curl[^\n]*(--request|-X)\s*(POST|PUT|PATCH|DELETE)/u);
  assert.match(secondPassHelper, /PRODUCTION_MUTATION=NO/u);
  assert.match(secondPassHelper, /SYSTEMD_MUTATION=NO/u);
  assert.match(secondPassHelper, /IDENTITY_PERMISSION_MUTATION=NO/u);
  assert.match(secondPassHelper, /DOCKER_AUTHORITY_MUTATION=NO/u);
  assert.match(secondPassHelper, /CLOUDFLARE_MUTATION=NO/u);
  assert.match(secondPassHelper, /TERMINAL_ACTIVATION=NO/u);
});

test("issue226 recovery preflight binds fresh host evidence to PLAN only", () => {
  for (const token of [
    "/opt/dashboard_RPi5/current",
    "/run/dashboard-rpi5-log-broker/broker.sock",
    "/var/log/rpi5-backup.log",
    "10-quick-commands.conf",
    "/v1/health",
    "/v1/logs/systemd:ssh/15m",
    "/api/current/docker",
    "tools/production-candidate-manifest.mjs",
    "tools/production-release-controller.mjs",
    "CANDIDATE_MANIFEST_VERIFY=PASS",
    "RELEASE_CONTROLLER_PLAN=PASS",
    "PLAN_OPERATIONS=",
  ]) {
    assert.ok(issue226Preflight.includes(token), `missing issue226 preflight token: ${token}`);
  }
  assert.match(issue226Preflight, /--max-time "\$timeout_seconds"/u);
  assert.match(
    issue226Preflight,
    /copy_manifest_allowlisted_release,write_verified_manifest_marker,atomic_current_symlink_swap/u,
  );
});

test("issue226 recovery preflight is fail-closed and contains no mutation path", () => {
  assert.doesNotMatch(issue226Preflight, /(^|\n)\s*sudo\s/u);
  assert.doesNotMatch(
    issue226Preflight,
    /systemctl\s+(start|stop|restart|reload|enable|disable|daemon-reload|reset-failed)\b/u,
  );
  assert.doesNotMatch(
    issue226Preflight,
    /\b(chmod|chown|usermod|useradd|groupadd|install|tee|truncate|touch|mkdir|rm|mv|cp)\b/u,
  );
  assert.doesNotMatch(
    issue226Preflight,
    /curl[^\n]*(--request|-X)\s*(POST|PUT|PATCH|DELETE)/u,
  );
  assert.doesNotMatch(issue226Preflight, /--apply/u);
  assert.doesNotMatch(issue226Preflight, /cloudflared/u);
  for (const token of [
    "PRODUCTION_MUTATION=NO",
    "SYSTEMD_MUTATION=NO",
    "IDENTITY_PERMISSION_MUTATION=NO",
    "DOCKER_AUTHORITY_MUTATION=NO",
    "CLOUDFLARE_MUTATION=NO",
    "TERMINAL_ACTIVATION=NO",
    "RESULT=READ_ONLY_RECOVERY_PREFLIGHT_PASS",
  ]) {
    assert.ok(issue226Preflight.includes(token), `missing issue226 no-mutation token: ${token}`);
  }
});

test("issue226 recovery preflight emits metadata only for sensitive boundaries", () => {
  assert.doesNotMatch(issue226Preflight, /cat\s+[^\n]*(web\.env|cloudflare|token|secret)/u);
  assert.doesNotMatch(issue226Preflight, /source\s+[^\n]*(web\.env|cloudflare|token|secret)/u);
  assert.doesNotMatch(issue226Preflight, /printf[^\n]*agent_environment/u);
  assert.match(issue226Preflight, /LOG_BROKER_SYSTEMD_SSH_BODY=DISCARDED/u);
  assert.match(issue226Preflight, /QUICK_COMMANDS_DROPIN_SHA256=/u);
  assert.match(issue226Preflight, /BACKUP_LOG_METADATA=/u);
});

test("issue196 production agent uses the bounded broker-backed Docker log reader", () => {
  assert.match(agentApp, /import \{ readLiveLogSnapshot \} from "\.\/docker-logs-live\.js";/u);
  assert.match(agentApp, /readLiveLogSnapshot\(sourceId, range, signal\)/u);
  assert.doesNotMatch(agentApp, /readLogSnapshot\(sourceId, range, undefined, signal\)/u);
});

test("issue196 production navigation does not expose the Phase 1 settings fixture", () => {
  assert.doesNotMatch(liveShell, /to: "\/settings"/u);
  assert.doesNotMatch(webMain, /ReliabilityStatesPage/u);
  assert.doesNotMatch(webMain, /path: "settings"/u);
  assert.doesNotMatch(webMain, /reliability-states\.css/u);
});
