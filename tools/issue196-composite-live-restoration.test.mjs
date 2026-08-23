import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import test from "node:test";
import assert from "node:assert/strict";

const helperPath = resolve("tools/operator/issue196-composite-live-restoration.sh");
const helperModules = [
  helperPath,
  resolve("tools/operator/issue196-composite-live-common.sh"),
  resolve("tools/operator/issue196-composite-live-transaction.sh"),
  resolve("tools/operator/issue196-composite-live-apply.sh"),
];
const helper = (await Promise.all(helperModules.map((path) => readFile(path, "utf8")))).join("\n");
const correctionPath = resolve("tools/operator/issue196-post-live-evidence-correction.sh");
const correction = await readFile(correctionPath, "utf8");

test("issue196 operator scripts are valid bash", () => {
  for (const path of [...helperModules, correctionPath]) {
    execFileSync("bash", ["-n", path], { stdio: "pipe" });
  }
});

test("historical helper pins the reviewed functional and producer boundaries", () => {
  assert.match(helper, /FUNCTIONAL_BASE_SHA="fb8b6067ae12eacfbfc21d2c104602f7fa257c1f"/u);
  assert.match(helper, /FUNCTIONAL_BASE_TREE="ec859e2b1d5c74be47986305d126dacf75093e0e"/u);
  assert.match(helper, /PRODUCER_REVIEWED_SHA="dff7d6346140f8be98c2edb09a6663d80688e0d7"/u);
  assert.match(helper, /TRUSTED_BACKUP_SHA256="5ca85ae53bdf4fa3b99e21e1a30ddaa077d9e1791505b1e8389ee8587d011735"/u);
  assert.match(helper, /bcf43633a61139153e3bac3b2c61f5118c742459/u);
  assert.match(helper, /AUTHORIZE_ISSUE196_COMPOSITE_LIVE_RESTORATION/u);
  assert.match(helper, /I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ACTIVATION/u);
});

test("dashboard post-base lineage is limited to the final issue196 gate", () => {
  for (const path of [
    "apps/agent/src/app.ts",
    "apps/agent/src/docker-logs-live.test.ts",
    "apps/agent/src/docker-logs-live.ts",
    "apps/agent/src/production-log-sources.test.ts",
    "apps/agent/src/production-log-sources.ts",
    "docs/ISSUE196_COMPOSITE_LIVE_RESTORATION.md",
    "docs/PHASE5B_UNIFIED_LOGS.md",
    "package.json",
    "tools/issue196-composite-live-restoration.test.mjs",
    "tools/operator/issue196-composite-live-restoration.sh",
    "tools/operator/issue196-composite-live-common.sh",
    "tools/operator/issue196-composite-live-transaction.sh",
    "tools/operator/issue196-composite-live-apply.sh",
  ]) {
    assert.ok(helper.includes(`"${path}"`));
  }
  assert.match(helper, /dashboard main contains unrelated post-#200 source/u);
  assert.match(helper, /merge-base --is-ancestor "\$FUNCTIONAL_BASE_SHA" "\$TARGET_SHA"/u);
});

test("historical producer source stays pinned without broad authority expansion", () => {
  for (const blob of [
    "059ac81b6af5aebb56ebd92a03407a5c28847954",
    "e6884b488b7aed584d816ab91ddc362d8bcdad2b",
    "f611f3a7f037b59b18e8224edfc31f9d9e7e80cf",
    "da08d8bc8d01a6543fef0eb7bcecd52696523459",
    "5bbd78fbe3d402becd310c835925233ce0301a12",
    "41e8317b22c91aafbfb4159b14c856f4ae9c8590",
    "27c99feebcf33da55e21471837750e9e28155b67",
    "8dde57f1a8bcc8561a9fb27df318a7d9d8367f70",
  ]) {
    assert.ok(helper.includes(blob));
  }
  assert.match(helper, /for forbidden in docker video adm systemd-journal/u);
  assert.doesNotMatch(helper, /usermod|gpasswd|setfacl/u);
});

test("historical preflight dispatcher is production read-only", () => {
  const start = helper.indexOf("run_preflight() {");
  const end = helper.indexOf("run_apply() {", start);
  assert.ok(start >= 0 && end > start);
  const preflight = helper.slice(start, end);

  assert.match(preflight, /RESULT=PREFLIGHT_PASS/u);
  assert.match(preflight, /PRODUCTION_MUTATION=NO/u);
  assert.doesNotMatch(preflight, /sudo/u);
  assert.doesNotMatch(preflight, /systemctl restart/u);
  assert.doesNotMatch(preflight, /systemctl enable/u);
  assert.doesNotMatch(preflight, /--apply/u);
});

test("consumed historical apply fails before its first mutation", () => {
  const start = helper.indexOf("run_apply() {");
  const apply = helper.slice(start);
  const retired = apply.indexOf("original #196 Composite Live apply path is consumed and retired");
  const mutation = apply.indexOf('MUTATION_STARTED="YES"');
  assert.ok(retired >= 0 && mutation > retired);
  assert.match(apply.slice(0, mutation), /fail "original #196 Composite Live apply path is consumed and retired/u);
});

test("backup baseline recognizes the reviewed V25 wrapper/core split and preserves mode", () => {
  const start = helper.indexOf("require_backup_baseline() {");
  const end = helper.indexOf("require_public_access_boundary() {", start);
  assert.ok(start >= 0 && end > start);
  const baseline = helper.slice(start, end);

  assert.match(baseline, /0:0:750:regular file/u);
  assert.match(baseline, /! -L "\$BACKUP_ENTRYPOINT"/u);
  assert.match(baseline, /! -L "\$BACKUP_CORE"/u);
  assert.match(baseline, /bcf43633a61139153e3bac3b2c61f5118c742459/u);
  assert.match(baseline, /sudo \/usr\/bin\/git hash-object "\$BACKUP_ENTRYPOINT"/u);
  assert.match(baseline, /sudo \/usr\/bin\/sha256sum "\$BACKUP_CORE"/u);
  assert.match(helper, /install -o root -g root -m 0750 "\$\{PRODUCER_STAGE\}\/rpi5-backup-v10-core" "\$BACKUP_CORE"/u);
  assert.match(helper, /install -o root -g root -m 0750 "\$\{PRODUCER_STAGE\}\/rpi5-backup-serialized" "\$BACKUP_ENTRYPOINT"/u);
  assert.doesNotMatch(helper, /-m 0755 "\$\{PRODUCER_STAGE\}\/rpi5-backup-(?:v10-core|serialized)"/u);
});

test("historical receipt binds target, producer, current release, Prometheus hash and backup category", () => {
  const start = helper.indexOf("write_receipt() {");
  const end = helper.indexOf("receipt_value() {", start);
  assert.ok(start >= 0 && end > start);
  const receipt = helper.slice(start, end);
  for (const key of [
    "TARGET_SHA",
    "EXPECTED_CURRENT_SHA",
    "PRODUCER_CURRENT_SHA",
    "PRODUCER_REVIEWED_SHA",
    "PROMETHEUS_URL_SHA256",
    "RUN_BACKUP",
    "MANIFEST_SHA256",
  ]) {
    assert.ok(receipt.includes(`${key}=`));
  }
  assert.doesNotMatch(receipt, /PROMETHEUS_URL=/u);
});

test("Prometheus production env mutation replaces only one fixed key and preserves terminal exclusion", () => {
  const start = helper.indexOf("update_prometheus_env_without_disclosure() {");
  const end = helper.indexOf("require_evidence_files() {", start);
  assert.ok(start >= 0 && end > start);
  const envUpdate = helper.slice(start, end);
  assert.match(envUpdate, /path="\/etc\/dashboard-rpi5\/web\.env"/u);
  assert.match(envUpdate, /prefix="DASHBOARD_PROMETHEUS_URL="/u);
  assert.match(envUpdate, /DASHBOARD_TERMINAL_ENABLED=enabled/u);
  assert.match(envUpdate, /os\.replace\(tmp,path\)/u);
  assert.match(envUpdate, /stat\.S_IMODE\(st\.st_mode\) != 0o600/u);
  assert.doesNotMatch(envUpdate, /print\(url\)|sys\.stdout/u);
});

test("historical apply body preserves the original bounded mutation ordering behind retirement gate", () => {
  const start = helper.indexOf("run_apply() {");
  const apply = helper.slice(start);
  const mutation = apply.indexOf('MUTATION_STARTED="YES"');
  const release = apply.indexOf("run_release_controller_apply", mutation);
  const broker = apply.indexOf('systemctl restart "$BROKER_SERVICE"', release);
  const agent = apply.indexOf('systemctl restart "$AGENT_SERVICE"', broker);
  const producer = apply.indexOf("install_producer_source", agent);
  const daemonReload = apply.indexOf("systemctl daemon-reload", producer);
  const timer = apply.indexOf('systemctl enable --now "$EVIDENCE_TIMER"', daemonReload);
  const env = apply.indexOf("update_prometheus_env_without_disclosure", timer);
  const web = apply.indexOf('systemctl restart "$WEB_SERVICE"', env);
  const backup = apply.indexOf('sudo "$BACKUP_ENTRYPOINT"', web);
  const acceptance = apply.indexOf("final_acceptance", web);
  const deployEvidence = apply.indexOf("record_deploy_evidence", acceptance);

  assert.ok(
    mutation >= 0 &&
      release > mutation &&
      broker > release &&
      agent > broker &&
      producer > agent &&
      daemonReload > producer &&
      timer > daemonReload &&
      env > timer &&
      web > env &&
      backup > web &&
      acceptance > web &&
      deployEvidence > acceptance,
  );
});

test("historical backup execution remains explicit and receipt-bound", () => {
  assert.match(helper, /RUN_BACKUP="NO"/u);
  assert.match(helper, /--run-backup/u);
  assert.match(helper, /if \[\[ "\$RUN_BACKUP" == "YES" \]\]; then\s+sudo "\$BACKUP_ENTRYPOINT"/u);
  assert.match(helper, /receipt backup category mismatch/u);
});

test("historical failure contract preserves evidence and stops", () => {
  assert.match(helper, /RESULT=STOP_AFTER_MUTATION_ERROR/u);
  assert.match(helper, /NO_RETRY_ROLLBACK_CLEANUP=YES/u);
  assert.doesNotMatch(helper, /rm\s+-rf/u);
  assert.doesNotMatch(helper, /git\s+(reset|rebase|clean)/u);
});

test("historical acceptance covers restored read-only surfaces and Docker-only advertised logs", () => {
  assert.match(helper, /\/api\/history\/host\?range=24h/u);
  assert.match(helper, /\/api\/endpoints/u);
  assert.match(helper, /\/api\/backups/u);
  assert.match(helper, /\/api\/deployments/u);
  assert.match(helper, /docker:homeassistant/u);
  assert.match(helper, /docker:prometheus/u);
  assert.match(helper, /unavailable\.length !== 0/u);
  assert.match(helper, /terminal socket unexpectedly present/u);
  assert.match(helper, /public dashboard boundary no longer presents an access\/intercept response/u);
});

test("post-live correction pins exact old and corrected producer identities", () => {
  assert.match(correction, /EXPECTED_DASHBOARD_PRODUCTION_SHA="f80da3848d7e8981f096aed4b43d3ff251ab383b"/u);
  assert.match(correction, /OLD_HELPER_BLOB="da08d8bc8d01a6543fef0eb7bcecd52696523459"/u);
  assert.match(correction, /OLD_COLLECTOR_BLOB="f611f3a7f037b59b18e8224edfc31f9d9e7e80cf"/u);
  assert.match(correction, /NEW_HELPER_BLOB="883b741f884c3f122ca8bcd2f8ce8a2eb029a3f5"/u);
  assert.match(correction, /NEW_COLLECTOR_BLOB="ec96beb7ac9062a88ec17253c80d70fad419f550"/u);
  assert.match(correction, /AUTHORIZE_ISSUE196_POST_LIVE_EVIDENCE_CORRECTION/u);
  assert.match(correction, /for command_name in curl date git node sha256sum readlink stat systemctl id python3/u);
  assert.match(correction, /merge-base --is-ancestor "\$PRODUCER_BASE_SHA" "\$PRODUCER_CURRENT_SHA"/u);
});

test("post-live correction preflight is production read-only", () => {
  const start = correction.indexOf("run_preflight() {");
  const end = correction.indexOf("run_apply() {", start);
  assert.ok(start >= 0 && end > start);
  const preflight = correction.slice(start, end);
  assert.match(preflight, /RESULT=PREFLIGHT_PASS/u);
  assert.match(preflight, /PRODUCTION_MUTATION=NO/u);
  assert.match(preflight, /SYSTEMD_MUTATION=NO/u);
  assert.match(preflight, /DASHBOARD_DEPLOY=NO/u);
  assert.match(preflight, /BACKUP_EXECUTION=NO/u);
  assert.doesNotMatch(preflight, /sudo/u);
  assert.doesNotMatch(preflight, /systemctl\s+(start|restart|enable|daemon-reload)/u);
});

test("post-live apply mutates only helper, collector and one existing evidence oneshot", () => {
  const start = correction.indexOf("run_apply() {");
  const apply = correction.slice(start);
  const mutation = apply.indexOf('MUTATION_STARTED="YES"');
  const helperInstall = apply.indexOf('install -o root -g root -m 0644 "${STAGE}/dashboard-evidence.py"', mutation);
  const collectorInstall = apply.indexOf('install -o root -g root -m 0755 "${STAGE}/rpi5-dashboard-evidence"', helperInstall);
  const oneshot = apply.indexOf('systemctl start "$EVIDENCE_SERVICE"', collectorInstall);
  const deploymentAcceptance = apply.indexOf("require_corrected_deployment_state", oneshot);
  const maintenanceAcceptance = apply.indexOf("require_corrected_maintenance_state", deploymentAcceptance);
  assert.ok(
    mutation >= 0 &&
      helperInstall > mutation &&
      collectorInstall > helperInstall &&
      oneshot > collectorInstall &&
      deploymentAcceptance > oneshot &&
      maintenanceAcceptance > deploymentAcceptance,
  );
  assert.doesNotMatch(apply, /systemctl\s+(restart|enable|disable|daemon-reload)/u);
  assert.doesNotMatch(apply, /BACKUP_ENTRYPOINT|rpi5-backup/u);
  assert.doesNotMatch(apply, /DASHBOARD_PROMETHEUS_URL|release-controller/u);
});

test("post-live acceptance rejects the fake dashboard deployment identity", () => {
  assert.match(correction, /repository !== "rozkalnsandris\/RPi5_main"/u);
  assert.match(correction, /classification === "UNKNOWN"/u);
  assert.match(correction, /productionCommit === "f80da3848d7e"/u);
  assert.match(correction, /ExecMainExitTimestamp/u);
  assert.match(correction, /Date\.parse\(e\.occurredAt\)!==expected/u);
});

test("post-live correction preserves trust-boundary exclusions and stop rule", () => {
  assert.match(correction, /for forbidden in docker video adm systemd-journal/u);
  assert.match(correction, /RESULT=STOP_AFTER_MUTATION_ERROR/u);
  assert.match(correction, /NO_RETRY_ROLLBACK_CLEANUP=YES/u);
  assert.match(correction, /CLOUDFLARE_MUTATION=NO/u);
  assert.match(correction, /TERMINAL_ACTIVATION=NO/u);
  assert.doesNotMatch(correction, /usermod|gpasswd|setfacl/u);
  assert.doesNotMatch(correction, /cloudflared|wrangler/u);
  assert.doesNotMatch(correction, /systemctl\s+(start|restart|enable).*terminal/u);
  assert.doesNotMatch(correction, /rm\s+-rf|git\s+(reset|rebase|clean)/u);
});
