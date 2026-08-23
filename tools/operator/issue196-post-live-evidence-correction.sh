#!/usr/bin/env bash
set -Eeuo pipefail

MODE="preflight"
RECEIPT_SHA256=""
OWNER_ACK=""
MUTATION_STARTED="NO"

readonly DASHBOARD_API="https://api.github.com/repos/rozkalnsandris/dashboard_RPi5"
readonly PRODUCER_REPO="rozkalnsandris/RPi5_main"
readonly PRODUCER_API="https://api.github.com/repos/rozkalnsandris/RPi5_main"
readonly PRODUCER_GIT="https://github.com/rozkalnsandris/RPi5_main.git"
readonly PRODUCER_BASE_SHA="dff7d6346140f8be98c2edb09a6663d80688e0d7"
readonly EXPECTED_DASHBOARD_PRODUCTION_SHA="f80da3848d7e8981f096aed4b43d3ff251ab383b"
readonly OLD_HELPER_BLOB="da08d8bc8d01a6543fef0eb7bcecd52696523459"
readonly OLD_COLLECTOR_BLOB="f611f3a7f037b59b18e8224edfc31f9d9e7e80cf"
readonly NEW_HELPER_BLOB="883b741f884c3f122ca8bcd2f8ce8a2eb029a3f5"
readonly NEW_COLLECTOR_BLOB="ec96beb7ac9062a88ec17253c80d70fad419f550"
readonly OWNER_ACK_REQUIRED="AUTHORIZE_ISSUE196_POST_LIVE_EVIDENCE_CORRECTION"

readonly WEB_BASE="http://127.0.0.1:8787"
readonly CURRENT_LINK="/opt/dashboard_RPi5/current"
readonly AGENT_USER="dashboard-rpi5-agent"
readonly BROKER_SERVICE="dashboard-rpi5-docker-broker.service"
readonly AGENT_SERVICE="dashboard-rpi5-agent.service"
readonly WEB_SERVICE="dashboard-rpi5-web.service"
readonly EVIDENCE_SERVICE="rpi5-dashboard-evidence.service"
readonly EVIDENCE_TIMER="rpi5-dashboard-evidence.timer"
readonly LIVE_HELPER="/usr/local/lib/rpi5-maintenance/dashboard-evidence.py"
readonly LIVE_COLLECTOR="/usr/local/sbin/rpi5-dashboard-evidence"
readonly EVIDENCE_ROOT="/var/lib/dashboard-rpi5/evidence"

DASHBOARD_CURRENT_SHA=""
PRODUCER_CURRENT_SHA=""
RUN_ROOT=""
PRODUCER_CLONE=""
STAGE=""
RECEIPT=""

usage() {
  cat <<'USAGE'
usage:
  issue196-post-live-evidence-correction.sh --preflight-only
  issue196-post-live-evidence-correction.sh --apply --receipt-sha256 <64hex> --owner-ack AUTHORIZE_ISSUE196_POST_LIVE_EVIDENCE_CORRECTION

The correction is intentionally narrower than the consumed #196 Composite Live:
it may replace only the dashboard evidence helper/collector and start the existing
evidence oneshot once. It never deploys dashboard source, restarts services,
changes systemd units/timers, runs a backup, or mutates Cloudflare/terminal state.
USAGE
}

fail() {
  printf 'ERROR=%s\n' "$*" >&2
  return 1
}

on_error() {
  local rc="$?"
  trap - ERR
  if [[ "$MUTATION_STARTED" == "YES" ]]; then
    printf 'RESULT=STOP_AFTER_MUTATION_ERROR\n' >&2
    printf 'NO_RETRY_ROLLBACK_CLEANUP=YES\n' >&2
    printf 'MUTATION_STARTED=YES\n' >&2
  else
    printf 'RESULT=STOP_BEFORE_MUTATION\n' >&2
    printf 'MUTATION_STARTED=NO\n' >&2
  fi
  exit "$rc"
}
trap on_error ERR

while (($#)); do
  case "$1" in
    --preflight-only)
      MODE="preflight"
      shift
      ;;
    --apply)
      MODE="apply"
      shift
      ;;
    --receipt-sha256)
      [[ $# -ge 2 ]] || { usage >&2; exit 64; }
      RECEIPT_SHA256="$2"
      shift 2
      ;;
    --owner-ack)
      [[ $# -ge 2 ]] || { usage >&2; exit 64; }
      OWNER_ACK="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 64
      ;;
  esac
done

if [[ "$MODE" == "preflight" ]]; then
  [[ -z "$RECEIPT_SHA256" && -z "$OWNER_ACK" ]] || fail "preflight does not accept apply credentials"
else
  [[ "$RECEIPT_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail "apply requires exact receipt sha256"
  [[ "$OWNER_ACK" == "$OWNER_ACK_REQUIRED" ]] || fail "owner acknowledgement mismatch"
fi

for command_name in curl date git node sha256sum readlink stat systemctl id python3; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command missing: ${command_name}"
done

github_branch_sha() {
  local api="$1"
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "${api}/branches/main" |
    node -e '
      let s="";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data",c=>s+=c);
      process.stdin.on("end",()=>{
        const j=JSON.parse(s);
        const sha=j?.commit?.sha;
        if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) process.exit(2);
        process.stdout.write(sha);
      });
    '
}

require_push_ci_success() {
  local api="$1" sha="$2" workflow_name="$3"
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    "${api}/actions/runs?head_sha=${sha}&event=push&per_page=20" |
    node -e '
      let s="";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data",c=>s+=c);
      process.stdin.on("end",()=>{
        const j=JSON.parse(s);
        const runs=Array.isArray(j?.workflow_runs) ? j.workflow_runs : [];
        const ok=runs.some(r => r?.name === process.argv[1] && r?.head_sha === process.argv[2] &&
          r?.event === "push" && r?.status === "completed" && r?.conclusion === "success");
        if (!ok) process.exit(3);
      });
    ' "$workflow_name" "$sha"
}

current_release_sha() {
  local target release
  target="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  release="${target##*/}"
  [[ "$release" =~ ^[0-9a-f]{40}$ ]] || fail "production current release is not an exact SHA"
  printf '%s' "$release"
}

require_service_active() {
  local service="$1"
  [[ "$(systemctl is-active "$service" 2>/dev/null || true)" == "active" ]] ||
    fail "required service is not active: ${service}"
}

require_agent_groups() {
  local groups forbidden
  groups="$(id -nG "$AGENT_USER" 2>/dev/null || true)"
  [[ -n "$groups" ]] || fail "cannot resolve dashboard agent groups"
  for forbidden in docker video adm systemd-journal; do
    if tr ' ' '\n' <<<"$groups" | grep -Fxq "$forbidden"; then
      fail "dashboard agent gained forbidden group: ${forbidden}"
    fi
  done
}

require_terminal_absent() {
  [[ ! -S /run/dashboard-rpi5-terminal.sock ]] || fail "terminal socket unexpectedly present"
  [[ "$(systemctl is-active dashboard-rpi5-terminal.socket 2>/dev/null || true)" != "active" ]] ||
    fail "terminal socket unit unexpectedly active"
}

file_blob() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" ]] || fail "expected real file missing: ${path}"
  git hash-object "$path"
}

require_live_old_producer() {
  [[ "$(stat -c '%u:%g:%a:%F' "$LIVE_HELPER" 2>/dev/null || true)" == "0:0:644:regular file" ]] ||
    fail "live evidence helper metadata drift"
  [[ "$(stat -c '%u:%g:%a:%F' "$LIVE_COLLECTOR" 2>/dev/null || true)" == "0:0:755:regular file" ]] ||
    fail "live evidence collector metadata drift"
  [[ "$(file_blob "$LIVE_HELPER")" == "$OLD_HELPER_BLOB" ]] || fail "live evidence helper is not the expected pre-fix blob"
  [[ "$(file_blob "$LIVE_COLLECTOR")" == "$OLD_COLLECTOR_BLOB" ]] || fail "live evidence collector is not the expected pre-fix blob"
}

require_live_new_producer() {
  [[ "$(stat -c '%u:%g:%a:%F' "$LIVE_HELPER" 2>/dev/null || true)" == "0:0:644:regular file" ]] ||
    fail "corrected evidence helper metadata mismatch"
  [[ "$(stat -c '%u:%g:%a:%F' "$LIVE_COLLECTOR" 2>/dev/null || true)" == "0:0:755:regular file" ]] ||
    fail "corrected evidence collector metadata mismatch"
  [[ "$(file_blob "$LIVE_HELPER")" == "$NEW_HELPER_BLOB" ]] || fail "corrected evidence helper blob mismatch"
  [[ "$(file_blob "$LIVE_COLLECTOR")" == "$NEW_COLLECTOR_BLOB" ]] || fail "corrected evidence collector blob mismatch"
}

http_status() {
  local url="$1" status
  status="$(curl --silent --show-error --connect-timeout 3 --max-time 8 \
    --output /dev/null --write-out '%{http_code}' "$url" 2>/dev/null || true)"
  [[ "$status" =~ ^[0-9]{3}$ ]] || status="000"
  printf '%s' "$status"
}

require_http_200() {
  local path="$1" label="$2"
  [[ "$(http_status "${WEB_BASE}${path}")" == "200" ]] || fail "${label} did not return HTTP 200"
}

require_pre_fix_deployment_state() {
  curl --fail --silent --show-error --connect-timeout 3 --max-time 8 "${WEB_BASE}/api/deployments" |
    node -e '
      let s="";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data",c=>s+=c);
      process.stdin.on("end",()=>{
        const j=JSON.parse(s);
        if (j?.project?.repository !== "rozkalnsandris/RPi5_main" ||
            j?.project?.classification !== "UNKNOWN" ||
            j?.project?.productionCommit !== "f80da3848d7e") process.exit(2);
      });
    '
}

require_corrected_deployment_state() {
  curl --fail --silent --show-error --connect-timeout 3 --max-time 8 "${WEB_BASE}/api/deployments" |
    node -e '
      let s="";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data",c=>s+=c);
      process.stdin.on("end",()=>{
        const j=JSON.parse(s);
        const p=j?.project;
        if (p?.repository !== "rozkalnsandris/RPi5_main" ||
            p?.classification === "UNKNOWN" ||
            !/^[0-9a-f]{12}$/.test(p?.productionCommit ?? "") ||
            p?.productionCommit === "f80da3848d7e" ||
            !/^[0-9a-f]{40}$/.test(p?.mainSha ?? "")) process.exit(2);
      });
    '
}

require_corrected_maintenance_state() {
  local output key value invocation_id="" service_result="" exit_timestamp="" occurred_at=""
  output="$(systemctl show rpi5-update.service --no-pager \
    --property=InvocationID --property=Result --property=ExecMainExitTimestamp 2>/dev/null || true)"
  while IFS='=' read -r key value; do
    case "$key" in
      InvocationID) invocation_id="$value" ;;
      Result) service_result="$value" ;;
      ExecMainExitTimestamp) exit_timestamp="$value" ;;
    esac
  done <<<"$output"
  [[ "$invocation_id" =~ ^[0-9a-f]{32}$ ]] || return 0
  [[ "$service_result" =~ ^[A-Za-z0-9._:-]{1,64}$ ]] || return 0
  [[ -n "$exit_timestamp" ]] || return 0
  occurred_at="$(date -u --date="$exit_timestamp" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || true)"
  [[ -n "$occurred_at" ]] || fail "cannot normalize maintenance exit timestamp"
  node -e '
    const fs=require("fs");
    const path=process.argv[1], invocation=process.argv[2], expected=Date.parse(process.argv[3]);
    const j=JSON.parse(fs.readFileSync(path,"utf8"));
    const e=Array.isArray(j?.events) ? j.events.find(x=>x?.invocationId===invocation) : null;
    if (!e || Date.parse(e.occurredAt)!==expected) process.exit(2);
  ' "${EVIDENCE_ROOT}/maintenance.json" "$invocation_id" "$occurred_at"
}

configure_paths() {
  RUN_ROOT="${HOME}/.cache/dashboard-rpi5-operator/issue196-post-live-${DASHBOARD_CURRENT_SHA}-${PRODUCER_CURRENT_SHA}"
  PRODUCER_CLONE="${RUN_ROOT}/producer"
  STAGE="${RUN_ROOT}/stage"
  RECEIPT="${RUN_ROOT}/preflight.receipt"
}

stage_producer() {
  mkdir -p "$RUN_ROOT"
  [[ ! -e "$PRODUCER_CLONE" && ! -e "$STAGE" ]] || fail "preflight artifacts already exist; preserve prior evidence"
  git clone --quiet --no-checkout "$PRODUCER_GIT" "$PRODUCER_CLONE"
  git -C "$PRODUCER_CLONE" fetch --quiet origin "$PRODUCER_CURRENT_SHA" "$PRODUCER_BASE_SHA"
  git -C "$PRODUCER_CLONE" checkout --quiet --detach "$PRODUCER_CURRENT_SHA"
  git -C "$PRODUCER_CLONE" merge-base --is-ancestor "$PRODUCER_BASE_SHA" "$PRODUCER_CURRENT_SHA" ||
    fail "producer main no longer descends from reviewed evidence-producer base"
  [[ "$(git -C "$PRODUCER_CLONE" rev-parse "${PRODUCER_CURRENT_SHA}:ops/lib/dashboard-evidence.py")" == "$NEW_HELPER_BLOB" ]] ||
    fail "producer helper blob does not match reviewed correction"
  [[ "$(git -C "$PRODUCER_CLONE" rev-parse "${PRODUCER_CURRENT_SHA}:ops/bin/rpi5-dashboard-evidence")" == "$NEW_COLLECTOR_BLOB" ]] ||
    fail "producer collector blob does not match reviewed correction"
  mkdir -p "$STAGE"
  git -C "$PRODUCER_CLONE" show "${PRODUCER_CURRENT_SHA}:ops/lib/dashboard-evidence.py" >"${STAGE}/dashboard-evidence.py"
  git -C "$PRODUCER_CLONE" show "${PRODUCER_CURRENT_SHA}:ops/bin/rpi5-dashboard-evidence" >"${STAGE}/rpi5-dashboard-evidence"
  python3 -m py_compile "${STAGE}/dashboard-evidence.py"
  bash -n "${STAGE}/rpi5-dashboard-evidence"
  [[ "$(git hash-object "${STAGE}/dashboard-evidence.py")" == "$NEW_HELPER_BLOB" ]] || fail "staged helper blob mismatch"
  [[ "$(git hash-object "${STAGE}/rpi5-dashboard-evidence")" == "$NEW_COLLECTOR_BLOB" ]] || fail "staged collector blob mismatch"
}

write_receipt() {
  umask 077
  {
    printf 'RESULT=PASS\n'
    printf 'DASHBOARD_CURRENT_SHA=%s\n' "$DASHBOARD_CURRENT_SHA"
    printf 'PRODUCER_CURRENT_SHA=%s\n' "$PRODUCER_CURRENT_SHA"
    printf 'EXPECTED_DASHBOARD_PRODUCTION_SHA=%s\n' "$EXPECTED_DASHBOARD_PRODUCTION_SHA"
    printf 'OLD_HELPER_BLOB=%s\n' "$OLD_HELPER_BLOB"
    printf 'OLD_COLLECTOR_BLOB=%s\n' "$OLD_COLLECTOR_BLOB"
    printf 'NEW_HELPER_BLOB=%s\n' "$NEW_HELPER_BLOB"
    printf 'NEW_COLLECTOR_BLOB=%s\n' "$NEW_COLLECTOR_BLOB"
    printf 'PRODUCTION_MUTATION=NO\n'
    printf 'SYSTEMD_MUTATION=NO\n'
    printf 'DASHBOARD_DEPLOY=NO\n'
    printf 'BACKUP_EXECUTION=NO\n'
    printf 'CLOUDFLARE_MUTATION=NO\n'
    printf 'TERMINAL_ACTIVATION=NO\n'
  } >"$RECEIPT"
  chmod 0600 "$RECEIPT"
  printf 'PREFLIGHT_RECEIPT=%s\n' "$RECEIPT"
  printf 'PREFLIGHT_RECEIPT_SHA256=%s\n' "$(sha256sum "$RECEIPT" | awk '{print $1}')"
}

receipt_value() {
  local key="$1" value
  value="$(grep -E "^${key}=" "$RECEIPT" | cut -d= -f2- || true)"
  [[ -n "$value" ]] || fail "receipt key missing: ${key}"
  printf '%s' "$value"
}

load_receipt() {
  [[ -f "$RECEIPT" && ! -L "$RECEIPT" ]] || fail "preflight receipt missing"
  [[ "$(sha256sum "$RECEIPT" | awk '{print $1}')" == "$RECEIPT_SHA256" ]] || fail "preflight receipt hash mismatch"
  [[ "$(receipt_value RESULT)" == "PASS" ]] || fail "receipt is not PASS"
  [[ "$(receipt_value DASHBOARD_CURRENT_SHA)" == "$DASHBOARD_CURRENT_SHA" ]] || fail "dashboard main drift since preflight"
  [[ "$(receipt_value PRODUCER_CURRENT_SHA)" == "$PRODUCER_CURRENT_SHA" ]] || fail "producer main drift since preflight"
  [[ "$(receipt_value EXPECTED_DASHBOARD_PRODUCTION_SHA)" == "$EXPECTED_DASHBOARD_PRODUCTION_SHA" ]] || fail "production binding mismatch"
  [[ "$(receipt_value OLD_HELPER_BLOB)" == "$OLD_HELPER_BLOB" ]] || fail "old helper binding mismatch"
  [[ "$(receipt_value OLD_COLLECTOR_BLOB)" == "$OLD_COLLECTOR_BLOB" ]] || fail "old collector binding mismatch"
  [[ "$(receipt_value NEW_HELPER_BLOB)" == "$NEW_HELPER_BLOB" ]] || fail "new helper binding mismatch"
  [[ "$(receipt_value NEW_COLLECTOR_BLOB)" == "$NEW_COLLECTOR_BLOB" ]] || fail "new collector binding mismatch"
}

prewrite_baseline() {
  [[ "$(current_release_sha)" == "$EXPECTED_DASHBOARD_PRODUCTION_SHA" ]] || fail "dashboard production release drift"
  require_service_active "$BROKER_SERVICE"
  require_service_active "$AGENT_SERVICE"
  require_service_active "$WEB_SERVICE"
  require_service_active "$EVIDENCE_TIMER"
  [[ "$(systemctl is-failed "$EVIDENCE_SERVICE" 2>/dev/null || true)" != "failed" ]] || fail "evidence service is failed"
  require_agent_groups
  require_terminal_absent
  require_live_old_producer
  require_http_200 "/api/health" "dashboard health"
  require_pre_fix_deployment_state
}

run_preflight() {
  printf 'STAGE=ISSUE196_POST_LIVE_EVIDENCE_CORRECTION_PREFLIGHT\n'
  DASHBOARD_CURRENT_SHA="$(github_branch_sha "$DASHBOARD_API")"
  PRODUCER_CURRENT_SHA="$(github_branch_sha "$PRODUCER_API")"
  configure_paths
  [[ ! -e "$RUN_ROOT" ]] || fail "preflight run directory already exists; preserve prior evidence"
  stage_producer
  require_push_ci_success "$DASHBOARD_API" "$DASHBOARD_CURRENT_SHA" "CI"
  require_push_ci_success "$PRODUCER_API" "$PRODUCER_CURRENT_SHA" "Validate"
  prewrite_baseline
  write_receipt
  printf 'DASHBOARD_CURRENT_SHA=%s\n' "$DASHBOARD_CURRENT_SHA"
  printf 'PRODUCER_CURRENT_SHA=%s\n' "$PRODUCER_CURRENT_SHA"
  printf 'EXPECTED_DASHBOARD_PRODUCTION_SHA=%s\n' "$EXPECTED_DASHBOARD_PRODUCTION_SHA"
  printf 'PRODUCTION_MUTATION=NO\nSYSTEMD_MUTATION=NO\nDASHBOARD_DEPLOY=NO\nBACKUP_EXECUTION=NO\n'
  printf 'CLOUDFLARE_MUTATION=NO\nTERMINAL_ACTIVATION=NO\n'
  printf 'RESULT=PREFLIGHT_PASS\n'
}

run_apply() {
  printf 'STAGE=ISSUE196_POST_LIVE_EVIDENCE_CORRECTION_APPLY\n'
  DASHBOARD_CURRENT_SHA="$(github_branch_sha "$DASHBOARD_API")"
  PRODUCER_CURRENT_SHA="$(github_branch_sha "$PRODUCER_API")"
  configure_paths
  [[ -d "$PRODUCER_CLONE" && -d "$STAGE" ]] || fail "reviewed preflight artifacts are missing"
  load_receipt
  require_push_ci_success "$DASHBOARD_API" "$DASHBOARD_CURRENT_SHA" "CI"
  require_push_ci_success "$PRODUCER_API" "$PRODUCER_CURRENT_SHA" "Validate"
  prewrite_baseline
  [[ "$(git hash-object "${STAGE}/dashboard-evidence.py")" == "$NEW_HELPER_BLOB" ]] || fail "staged helper drift"
  [[ "$(git hash-object "${STAGE}/rpi5-dashboard-evidence")" == "$NEW_COLLECTOR_BLOB" ]] || fail "staged collector drift"

  MUTATION_STARTED="YES"

  sudo /usr/bin/install -o root -g root -m 0644 "${STAGE}/dashboard-evidence.py" "$LIVE_HELPER"
  sudo /usr/bin/install -o root -g root -m 0755 "${STAGE}/rpi5-dashboard-evidence" "$LIVE_COLLECTOR"
  sudo /usr/bin/systemctl start "$EVIDENCE_SERVICE"

  require_live_new_producer
  require_service_active "$EVIDENCE_TIMER"
  require_agent_groups
  require_terminal_absent
  [[ "$(current_release_sha)" == "$EXPECTED_DASHBOARD_PRODUCTION_SHA" ]] || fail "dashboard release changed during correction"
  require_http_200 "/api/health" "dashboard health after correction"
  require_corrected_deployment_state
  require_corrected_maintenance_state

  printf 'DASHBOARD_CURRENT_SHA=%s\n' "$DASHBOARD_CURRENT_SHA"
  printf 'PRODUCER_CURRENT_SHA=%s\n' "$PRODUCER_CURRENT_SHA"
  printf 'PRODUCTION_MUTATION=YES:evidence_helper_and_collector_only\n'
  printf 'SYSTEMD_MUTATION=YES:start_existing_evidence_oneshot_once\n'
  printf 'DASHBOARD_DEPLOY=NO\nBACKUP_EXECUTION=NO\nCLOUDFLARE_MUTATION=NO\nTERMINAL_ACTIVATION=NO\n'
  printf 'RESULT=ISSUE196_POST_LIVE_EVIDENCE_CORRECTION_PASS\n'
}

if [[ "$MODE" == "preflight" ]]; then
  run_preflight
else
  run_apply
fi
