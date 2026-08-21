#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

BASE_MAIN="f87f803e13ec50ec5909b27dc160da7e66621af3"
BASE_TREE="401d3cc7ca5f0b81417cac548a5af72f02da5485"
ACTIVATION_PR="173"
TARGET="a39fc7a9873eedb58cfa49568f9b2e05483cf7c2"
TARGET_TREE="bd2fa68711b1cf4617088a18c524e3c60d427152"
SOURCE_PR="160"
SOURCE_PR_HEAD="a44e95b4b480e29b8d537130903869c00fc3ef0d"
SOURCE_CI_RUN_ID="32407296336"
SOURCE_CI_RUN_NUMBER="368"
EXPECTED_CANDIDATE="eb3f406f798ad391ab692e81253c0f70dae1acb05ac7b62a6640cfff494818b0"
EXPECTED_MANIFEST_SHA="ce995eaebe239cf97364d3ef2a5f15516461e9780b591b02c609847e55674821"
EXPECTED_FILES="61"
EXPECTED_BYTES="6543699"
EXPECTED_CURRENT="4295c23de5634dcb86b5fe9f57be92416eb9a75b"
OWNER_ACK="I_AUTHORIZE_ISSUE126_PRODUCTION_ACTIVATION_A39FC7A9873EEDB58CFA49568F9B2E05483CF7C2"
RELEASE_ACK="I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ACTIVATION"
REPO_SLUG="rozkalnsandris/dashboard_RPi5"
PROD_ROOT="/opt/dashboard_RPi5"
CURRENT_LINK="$PROD_ROOT/current"
CURRENT_RELEASE="$PROD_ROOT/releases/$EXPECTED_CURRENT"
TARGET_RELEASE="$PROD_ROOT/releases/$TARGET"
LOCK_PATH="$PROD_ROOT/.dashboard-release-controller.lock"
R3_RUN_ROOT="/home/andris/.cache/dashboard-rpi5-operator/issue126-${BASE_MAIN}-r3"
WORKSPACE="$R3_RUN_ROOT/home/.cache/dashboard-rpi5-candidate-prep/${TARGET}-issue126"
REPO="$WORKSPACE/repo"
MANIFEST="$WORKSPACE/production-candidate.json"
BROKER_SERVICE="dashboard-rpi5-docker-broker.service"
AGENT_SERVICE="dashboard-rpi5-agent.service"
WEB_SERVICE="dashboard-rpi5-web.service"
BROKER_USER="dashboard-rpi5-docker-broker"
BROKER_GROUP="dashboard-rpi5-docker-client"
AGENT_USER="dashboard-rpi5-agent"
WEB_USER="dashboard-rpi5-web"
BROKER_SOCKET="/run/dashboard-rpi5-docker-broker/broker.sock"
AGENT_SOCKET="/run/dashboard-rpi5/agent.sock"
TERMINAL_SOCKET="/run/dashboard-rpi5-terminal.sock"
EXPECTED_PR_FILES='["docs/ISSUE126_PRODUCTION_ACTIVATION_GATE.md","package.json","tools/issue126-production-activation.test.mjs","tools/operator/issue126-production-activation.sh"]'

MODE=""
MUTATION_STARTED="NO"
CURRENT_STAGE="argument-parse"

blocked() {
  printf 'ISSUE126_ACTIVATION_BLOCKED stage=%s reason=%s\n' "$CURRENT_STAGE" "$*" >&2
  exit 1
}

on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ "$MUTATION_STARTED" = YES ]; then
      printf '%s\n' \
        "ISSUE126_ACTIVATION_EXIT=$rc" \
        "MUTATION_STARTED=YES" \
        "AUTHORIZATION_CONSUMED=YES" \
        "AUTO_RETRY=NO" \
        "AUTO_ROLLBACK=NO" \
        "AUTO_CLEANUP=NO" \
        "SYSTEMD_UNIT_MUTATION=NO" \
        "IDENTITY_MUTATION=NO" \
        "PERMISSION_WIDENING=NO" \
        "CLOUDFLARE_MUTATION=NO" \
        "TERMINAL_MUTATION=NO" \
        "ACTIONS_MUTATION=NO" >&2
    else
      printf '%s\n' \
        "ISSUE126_ACTIVATION_EXIT=$rc" \
        "MUTATION_STARTED=NO" \
        "AUTHORIZATION_CONSUMED=NO" \
        "PRODUCTION_MUTATION=NO" \
        "AUTO_RETRY=NO" \
        "AUTO_CLEANUP=NO" >&2
    fi
  fi
}
trap on_exit EXIT

need() { command -v "$1" >/dev/null 2>&1 || blocked "missing command: $1"; }
for c in curl jq git node sha256sum systemctl readlink stat id getent grep awk sudo tail tr cmp date sleep; do need "$c"; done

[ "$(id -u)" -ne 0 ] || blocked "run as normal operator, not root"
[ "$(id -un)" = "andris" ] || blocked "run as operator andris"
[ "$HOME" = "/home/andris" ] || blocked "unexpected operator HOME: $HOME"
[ "$(node -p 'process.versions.node.split(".")[0]')" = 24 ] || blocked "Node major is not 24"
MODEL="$(tr -d '\000' < /proc/device-tree/model 2>/dev/null || true)"
case "$MODEL" in
  "Raspberry Pi 5 Model B"*) ;;
  *) blocked "not Raspberry Pi 5 Model B: ${MODEL:-unknown}" ;;
esac

if [ "$#" -eq 1 ] && [ "$1" = "--preflight-only" ]; then
  MODE="preflight"
elif [ "$#" -eq 2 ] && [ "$1" = "--owner-ack" ]; then
  MODE="activate"
  [ "$2" = "$OWNER_ACK" ] || blocked "owner acknowledgement mismatch"
else
  blocked "usage: $0 --preflight-only | --owner-ack <exact-ack>"
fi

unix_status() {
  local user="$1" socket="$2" path="$3" timeout="${4:-8}"
  sudo -u "$user" curl -sS --max-time "$timeout" --unix-socket "$socket" \
    -o /dev/null -w '%{http_code}' "http://localhost$path"
}

loopback_status() {
  local path="$1" timeout="${2:-8}"
  curl -sS --max-time "$timeout" -o /dev/null -w '%{http_code}' "http://127.0.0.1:8787$path"
}

proc_has_gid() {
  local pid="$1" gid="$2"
  sudo awk -v wanted="$gid" '/^Groups:/ { for (i=2; i<=NF; i++) if ($i == wanted) found=1 } END { exit(found ? 0 : 1) }' "/proc/$pid/status"
}

service_pid() { systemctl show "$1" -p MainPID --value; }
service_restarts() { systemctl show "$1" -p NRestarts --value; }
service_cwd() { sudo readlink -f "/proc/$2/cwd"; }

assert_service_base() {
  local service="$1" expected_cwd="$2" pid nr cwd
  [ "$(systemctl is-active "$service")" = active ] || blocked "$service not active"
  [ "$(systemctl show "$service" -p Result --value)" = success ] || blocked "$service result drift"
  [ "$(systemctl show "$service" -p ExecMainStatus --value)" = 0 ] || blocked "$service exec status drift"
  pid="$(service_pid "$service")"
  nr="$(service_restarts "$service")"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || blocked "$service invalid PID"
  [[ "$nr" =~ ^[0-9]+$ ]] || blocked "$service invalid NRestarts"
  cwd="$(service_cwd "$service" "$pid")"
  [ "$cwd" = "$expected_cwd" ] || blocked "$service cwd drift: $cwd"
  printf '%s %s\n' "$pid" "$nr"
}

wait_broker_ready() {
  local old_pid="$1" expected_nr="$2" index pid nr cwd meta
  for ((index=0; index<100; index+=1)); do
    [ "$(systemctl is-active "$BROKER_SERVICE" 2>/dev/null || true)" = active ] || return 2
    pid="$(service_pid "$BROKER_SERVICE")"
    nr="$(service_restarts "$BROKER_SERVICE")"
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 3
    [ "$pid" != "$old_pid" ] || { sleep 0.2; continue; }
    [ "$nr" = "$expected_nr" ] || return 4
    cwd="$(sudo readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    [ "$cwd" = "$TARGET_RELEASE" ] || return 5
    if sudo test -S "$BROKER_SOCKET"; then
      meta="$(sudo stat -Lc '%U:%G:%a:%F' "$BROKER_SOCKET" 2>/dev/null || true)"
      if [ "$meta" = "$BROKER_USER:$BROKER_GROUP:660:socket" ] \
        && [ "$(unix_status "$BROKER_USER" "$BROKER_SOCKET" '/v1/health' 3 2>/dev/null || true)" = 200 ]; then
        printf '%s\n' "$pid"
        return 0
      fi
    fi
    sleep 0.2
  done
  return 1
}

wait_agent_ready() {
  local old_pid="$1" expected_nr="$2" index pid nr cwd meta
  for ((index=0; index<100; index+=1)); do
    [ "$(systemctl is-active "$AGENT_SERVICE" 2>/dev/null || true)" = active ] || return 2
    pid="$(service_pid "$AGENT_SERVICE")"
    nr="$(service_restarts "$AGENT_SERVICE")"
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 3
    [ "$pid" != "$old_pid" ] || { sleep 0.2; continue; }
    [ "$nr" = "$expected_nr" ] || return 4
    cwd="$(sudo readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    [ "$cwd" = "$TARGET_RELEASE" ] || return 5
    if sudo test -S "$AGENT_SOCKET"; then
      meta="$(sudo stat -Lc '%U:%G:%a:%F' "$AGENT_SOCKET" 2>/dev/null || true)"
      if [ "$meta" = 'dashboard-rpi5-agent:dashboard-rpi5-agent-client:660:socket' ] \
        && [ "$(unix_status "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary' 3 2>/dev/null || true)" = 200 ]; then
        printf '%s\n' "$pid"
        return 0
      fi
    fi
    sleep 0.2
  done
  return 1
}

wait_web_ready() {
  local old_pid="$1" expected_nr="$2" index pid nr cwd
  for ((index=0; index<100; index+=1)); do
    [ "$(systemctl is-active "$WEB_SERVICE" 2>/dev/null || true)" = active ] || return 2
    pid="$(service_pid "$WEB_SERVICE")"
    nr="$(service_restarts "$WEB_SERVICE")"
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 3
    [ "$pid" != "$old_pid" ] || { sleep 0.2; continue; }
    [ "$nr" = "$expected_nr" ] || return 4
    cwd="$(sudo readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    [ "$cwd" = "$TARGET_RELEASE" ] || return 5
    if [ "$(loopback_status '/api/health' 3 2>/dev/null || true)" = 200 ]; then
      printf '%s\n' "$pid"
      return 0
    fi
    sleep 0.2
  done
  return 1
}

assert_access_302() {
  local headers
  headers="$(curl -sS --max-time 10 -D - -o /dev/null -w $'\nCODE:%{http_code}\n' https://dash.rozkalns.net/)" || blocked "Cloudflare Access probe failed"
  printf '%s' "$headers" | grep -q 'CODE:302' || blocked "Cloudflare Access code drift"
  printf '%s' "$headers" | grep -qi '^www-authenticate:.*cloudflare-access' || blocked "Cloudflare Access marker missing"
}

assert_candidate() {
  [ -d "$REPO/.git" ] || blocked "R3 candidate repo missing"
  [ -f "$MANIFEST" ] || blocked "R3 candidate manifest missing"
  [ "$(git --git-dir="$REPO/.git" rev-parse HEAD)" = "$TARGET" ] || blocked "candidate repo HEAD drift"
  [ "$(git --git-dir="$REPO/.git" rev-parse 'HEAD^{tree}')" = "$TARGET_TREE" ] || blocked "candidate repo tree drift"
  [ "$(sha256sum "$MANIFEST" | awk '{print $1}')" = "$EXPECTED_MANIFEST_SHA" ] || blocked "candidate manifest SHA drift"
  [ "$(jq -er '.sourceSha' "$MANIFEST")" = "$TARGET" ] || blocked "candidate manifest source drift"
  [ "$(jq -er '.candidateSha256' "$MANIFEST")" = "$EXPECTED_CANDIDATE" ] || blocked "candidate digest drift"
  [ "$(jq -er '.fileCount' "$MANIFEST")" = "$EXPECTED_FILES" ] || blocked "candidate file count drift"
  [ "$(jq -er '.totalBytes' "$MANIFEST")" = "$EXPECTED_BYTES" ] || blocked "candidate byte count drift"
  node "$REPO/tools/production-candidate-manifest.mjs" --root "$REPO" --sha "$TARGET" --verify "$MANIFEST" \
    | grep -q '"status":"PASS"' || blocked "candidate manifest verification failed"
}

CURRENT_STAGE="github-source-gate"
base_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/commits/$BASE_MAIN")" || blocked "base main lookup failed"
[ "$(printf '%s' "$base_json" | jq -er '.sha')" = "$BASE_MAIN" ] || blocked "base main SHA drift"
[ "$(printf '%s' "$base_json" | jq -er '.commit.tree.sha')" = "$BASE_TREE" ] || blocked "base main tree drift"
[ "$(printf '%s' "$base_json" | jq -er '.commit.verification.verified')" = true ] || blocked "base main signature not verified"

main_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/branches/main")" || blocked "main lookup failed"
main_sha="$(printf '%s' "$main_json" | jq -er '.commit.sha')"
[ "$(printf '%s' "$main_json" | jq -er '.commit.commit.verification.verified')" = true ] || blocked "live main signature not verified"

activation_pr_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/pulls/$ACTIVATION_PR")" || blocked "PR173 lookup failed"
[ "$(printf '%s' "$activation_pr_json" | jq -er '.state')" = closed ] || blocked "PR173 not closed"
[ "$(printf '%s' "$activation_pr_json" | jq -er '.merged')" = true ] || blocked "PR173 not merged"
[ "$(printf '%s' "$activation_pr_json" | jq -er '.base.sha')" = "$BASE_MAIN" ] || blocked "PR173 base drift"
[ "$(printf '%s' "$activation_pr_json" | jq -er '.merge_commit_sha')" = "$main_sha" ] || blocked "live main is not PR173 squash merge"
activation_head="$(printf '%s' "$activation_pr_json" | jq -er '.head.sha')"

main_commit_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/commits/$main_sha")" || blocked "live main commit lookup failed"
[ "$(printf '%s' "$main_commit_json" | jq -er '.commit.verification.verified')" = true ] || blocked "live main commit signature not verified"
[ "$(printf '%s' "$main_commit_json" | jq -er '.parents | length')" -eq 1 ] || blocked "PR173 merge must have exactly one parent"
[ "$(printf '%s' "$main_commit_json" | jq -er '.parents[0].sha')" = "$BASE_MAIN" ] || blocked "PR173 merge parent drift"

compare_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/compare/$BASE_MAIN...$main_sha")" || blocked "PR173 compare lookup failed"
[ "$(printf '%s' "$compare_json" | jq -er '.status')" = ahead ] || blocked "PR173 compare status drift"
[ "$(printf '%s' "$compare_json" | jq -er '.ahead_by')" -eq 1 ] || blocked "PR173 compare must be exactly one squash commit"
[ "$(printf '%s' "$compare_json" | jq -er '.behind_by')" -eq 0 ] || blocked "PR173 compare unexpectedly behind"
[ "$(printf '%s' "$compare_json" | jq -er '.total_commits')" -eq 1 ] || blocked "PR173 compare total_commits drift"
actual_files="$(printf '%s' "$compare_json" | jq -c '[.files[].filename] | sort')"
[ "$actual_files" = "$EXPECTED_PR_FILES" ] || blocked "PR173 changed-file boundary drift: $actual_files"

runs_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/actions/runs?head_sha=$activation_head&event=pull_request&per_page=100")" || blocked "PR173 CI lookup failed"
run_id="$(printf '%s' "$runs_json" | jq -er --arg head "$activation_head" '[.workflow_runs[] | select(.name == "CI" and .head_sha == $head and .status == "completed" and .conclusion == "success")] | sort_by(.run_number) | last | .id')" || blocked "PR173 exact-head CI not successful"
jobs_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/actions/runs/$run_id/jobs?per_page=100")" || blocked "PR173 CI jobs lookup failed"
for job_name in "check" "terminal-native (x64)" "terminal-native (arm64)"; do
  count="$(printf '%s' "$jobs_json" | jq -er --arg name "$job_name" '[.jobs[] | select(.name == $name and .status == "completed" and .conclusion == "success")] | length')"
  [ "$count" -eq 1 ] || blocked "required PR173 CI job not success: $job_name count=$count"
done

source_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/commits/$TARGET")" || blocked "target source lookup failed"
[ "$(printf '%s' "$source_json" | jq -er '.commit.tree.sha')" = "$TARGET_TREE" ] || blocked "target tree drift"
[ "$(printf '%s' "$source_json" | jq -er '.commit.verification.verified')" = true ] || blocked "target signature not verified"
source_pr_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/pulls/$SOURCE_PR")" || blocked "PR160 lookup failed"
[ "$(printf '%s' "$source_pr_json" | jq -er '.merged')" = true ] || blocked "PR160 not merged"
[ "$(printf '%s' "$source_pr_json" | jq -er '.head.sha')" = "$SOURCE_PR_HEAD" ] || blocked "PR160 head drift"
[ "$(printf '%s' "$source_pr_json" | jq -er '.merge_commit_sha')" = "$TARGET" ] || blocked "PR160 merge drift"
source_run_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/actions/runs/$SOURCE_CI_RUN_ID")" || blocked "CI368 lookup failed"
[ "$(printf '%s' "$source_run_json" | jq -er '.run_number')" = "$SOURCE_CI_RUN_NUMBER" ] || blocked "CI368 run number drift"
[ "$(printf '%s' "$source_run_json" | jq -er '.head_sha')" = "$SOURCE_PR_HEAD" ] || blocked "CI368 head drift"
[ "$(printf '%s' "$source_run_json" | jq -er '.status')" = completed ] || blocked "CI368 not completed"
[ "$(printf '%s' "$source_run_json" | jq -er '.conclusion')" = success ] || blocked "CI368 not successful"
printf 'ISSUE126_ACTIVATION_SOURCE_GATE_PASS main=%s pr173_head=%s ci=%s target=%s target_tree=%s\n' \
  "$main_sha" "$activation_head" "$run_id" "$TARGET" "$TARGET_TREE"

CURRENT_STAGE="candidate-reproof"
assert_candidate
smoke="$(node "$REPO/tools/production-runtime-smoke.mjs" --root "$REPO" --manifest "$MANIFEST" --sha "$TARGET")" || blocked "runtime smoke failed"
[ "$(printf '%s' "$smoke" | jq -er '.status')" = PASS ] || blocked "runtime smoke not PASS"
[ "$(printf '%s' "$smoke" | jq -er '.candidateSha256')" = "$EXPECTED_CANDIDATE" ] || blocked "runtime smoke candidate drift"
printf 'ISSUE126_ACTIVATION_CANDIDATE_PASS candidate=%s manifest_sha256=%s files=%s bytes=%s\n' \
  "$EXPECTED_CANDIDATE" "$EXPECTED_MANIFEST_SHA" "$EXPECTED_FILES" "$EXPECTED_BYTES"

CURRENT_STAGE="production-preflight"
[ "$(readlink "$CURRENT_LINK")" = "releases/$EXPECTED_CURRENT" ] || blocked "current release pointer drift"
[ ! -e "$TARGET_RELEASE" ] || blocked "target release already exists; no reuse/cleanup path"
[ ! -e "$LOCK_PATH" ] || blocked "release-controller lock exists; no cleanup path"
[ -f "$CURRENT_RELEASE/.dashboard-production-candidate.json" ] || blocked "current release manifest marker missing"

for unit in dashboard-rpi5-docker-broker.service dashboard-rpi5-agent.service dashboard-rpi5-web.service; do
  cmp -s "$REPO/ops/systemd/$unit" "/etc/systemd/system/$unit" || blocked "installed unit differs from target source: $unit"
done

read -r broker_pid broker_nr < <(assert_service_base "$BROKER_SERVICE" "$CURRENT_RELEASE")
read -r agent_pid agent_nr < <(assert_service_base "$AGENT_SERVICE" "$CURRENT_RELEASE")
read -r web_pid web_nr < <(assert_service_base "$WEB_SERVICE" "$CURRENT_RELEASE")

broker_gid="$(getent group "$BROKER_GROUP" | awk -F: '{print $3}')"
docker_gid="$(getent group docker | awk -F: '{print $3}')"
video_gid="$(getent group video | awk -F: '{print $3}')"
for gid in "$broker_gid" "$docker_gid" "$video_gid"; do [[ "$gid" =~ ^[0-9]+$ ]] || blocked "required GID unavailable"; done
for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then blocked "agent persistent group boundary violated: $forbidden_group"; fi
done
proc_has_gid "$agent_pid" "$broker_gid" || blocked "agent runtime broker-client group missing"
if proc_has_gid "$agent_pid" "$docker_gid"; then blocked "agent runtime Docker group appeared"; fi
if proc_has_gid "$agent_pid" "$video_gid"; then blocked "agent runtime video group appeared"; fi
proc_has_gid "$broker_pid" "$docker_gid" || blocked "broker runtime Docker group missing"
[ "$(sudo stat -Lc '%U:%G:%a:%F' /var/run/docker.sock)" = 'root:docker:660:socket' ] || blocked "Docker socket metadata drift"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$BROKER_SOCKET")" = "$BROKER_USER:$BROKER_GROUP:660:socket" ] || blocked "broker socket metadata drift"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$AGENT_SOCKET")" = 'dashboard-rpi5-agent:dashboard-rpi5-agent-client:660:socket' ] || blocked "agent socket metadata drift"

[ "$(unix_status "$BROKER_USER" "$BROKER_SOCKET" '/v1/health' 5)" = 200 ] || blocked "broker health not 200"
[ "$(unix_status "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/containers' 12)" = 200 ] || blocked "broker Docker not 200"
[ "$(unix_status "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/logs/homeassistant/15m' 8)" = 200 ] || blocked "broker HA logs not 200"
now_epoch="$(date +%s)"; since_epoch="$((now_epoch - 60))"
[ "$(unix_status "$BROKER_USER" "$BROKER_SOCKET" "/v1/docker/events/recent?since=$since_epoch&until=$now_epoch" 5 || true)" = 404 ] || blocked "broker events must be 404 before activation"
[ "$(unix_status "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary' 5)" = 200 ] || blocked "agent host not 200"
[ "$(unix_status "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' 12)" = 200 ] || blocked "agent Docker not 200"
[ "$(unix_status "$WEB_USER" "$AGENT_SOCKET" '/v1/logs?sourceId=docker%3Ahomeassistant&range=15m' 8)" = 200 ] || blocked "agent logs not 200"
[ "$(unix_status "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' 5)" = 200 ] || blocked "agent Quick Commands not 200"
[ "$(unix_status "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' 5 || true)" = 503 ] || blocked "agent events must be 503 before activation"
[ "$(loopback_status '/api/health' 5)" = 200 ] || blocked "web health not 200"
[ "$(loopback_status '/api/current/host' 5)" = 200 ] || blocked "web host not 200"
[ "$(loopback_status '/api/current/docker' 12)" = 200 ] || blocked "web Docker not 200"
[ "$(loopback_status '/api/quick-commands' 5)" = 200 ] || blocked "web Quick Commands not 200"
[ ! -S "$TERMINAL_SOCKET" ] || blocked "terminal socket unexpectedly exists"
assert_access_302

plan="$(cd "$REPO" && sudo /usr/bin/node tools/production-release-controller.mjs --candidate-root "$REPO" --manifest "$MANIFEST" --sha "$TARGET")" || blocked "release-controller PLAN failed"
[ "$(printf '%s' "$plan" | jq -er '.status')" = PLAN ] || blocked "release PLAN status mismatch"
[ "$(printf '%s' "$plan" | jq -er '.candidateSha256')" = "$EXPECTED_CANDIDATE" ] || blocked "release PLAN candidate mismatch"
[ "$(printf '%s' "$plan" | jq -er '.observedCurrent')" = "$EXPECTED_CURRENT" ] || blocked "release PLAN current mismatch"
[ "$(printf '%s' "$plan" | jq -er '.targetRelease')" = absent ] || blocked "release PLAN target should be absent"
printf 'ISSUE126_ACTIVATION_PREFLIGHT_PASS current=%s candidate=%s broker_pid=%s broker_nrestarts=%s agent_pid=%s agent_nrestarts=%s web_pid=%s web_nrestarts=%s events=503 terminal=absent access=302\n' \
  "$EXPECTED_CURRENT" "$EXPECTED_CANDIDATE" "$broker_pid" "$broker_nr" "$agent_pid" "$agent_nr" "$web_pid" "$web_nr"

if [ "$MODE" = preflight ]; then
  printf 'ISSUE126_ACTIVATION_PREFLIGHT_STOP PRODUCTION_MUTATION=NO AUTHORIZATION_CONSUMED=NO\n'
  exit 0
fi

CURRENT_STAGE="final-race-gate"
main_recheck="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/branches/main" | jq -er '.commit.sha')" || blocked "main race recheck failed"
[ "$main_recheck" = "$main_sha" ] || blocked "main moved before activation"
[ "$(readlink "$CURRENT_LINK")" = "releases/$EXPECTED_CURRENT" ] || blocked "current pointer moved before activation"
[ ! -e "$TARGET_RELEASE" ] || blocked "target release appeared before activation"
[ ! -e "$LOCK_PATH" ] || blocked "release-controller lock appeared before activation"
[ "$(service_pid "$BROKER_SERVICE")" = "$broker_pid" ] || blocked "broker PID drift before activation"
[ "$(service_restarts "$BROKER_SERVICE")" = "$broker_nr" ] || blocked "broker NRestarts drift before activation"
[ "$(service_pid "$AGENT_SERVICE")" = "$agent_pid" ] || blocked "agent PID drift before activation"
[ "$(service_restarts "$AGENT_SERVICE")" = "$agent_nr" ] || blocked "agent NRestarts drift before activation"
[ "$(service_pid "$WEB_SERVICE")" = "$web_pid" ] || blocked "web PID drift before activation"
[ "$(service_restarts "$WEB_SERVICE")" = "$web_nr" ] || blocked "web NRestarts drift before activation"
assert_candidate
printf 'ISSUE126_ACTIVATION_RACE_GATE_PASS main=%s current=%s candidate=%s\n' "$main_sha" "$EXPECTED_CURRENT" "$EXPECTED_CANDIDATE"

MUTATION_STARTED="YES"
CURRENT_STAGE="release-apply"
printf 'ISSUE126_ACTIVATION_MUTATION_STARTED stage=%s AUTHORIZATION_CONSUMED=YES\n' "$CURRENT_STAGE"
apply="$(cd "$REPO" && sudo /usr/bin/node tools/production-release-controller.mjs --apply \
  --candidate-root "$REPO" --manifest "$MANIFEST" --sha "$TARGET" \
  --expected-current "$EXPECTED_CURRENT" --ack "$RELEASE_ACK")" || blocked "release-controller apply failed"
[ "$(printf '%s' "$apply" | jq -er '.status')" = APPLIED ] || blocked "release apply status mismatch"
[ "$(printf '%s' "$apply" | jq -er '.previousRelease')" = "$EXPECTED_CURRENT" ] || blocked "release previous mismatch"
[ "$(printf '%s' "$apply" | jq -er '.currentRelease')" = "$TARGET" ] || blocked "release current mismatch"
[ "$(readlink "$CURRENT_LINK")" = "releases/$TARGET" ] || blocked "current pointer did not move to target"
[ ! -e "$LOCK_PATH" ] || blocked "release-controller lock remained after apply"
[ -f "$TARGET_RELEASE/.dashboard-production-candidate.json" ] || blocked "target manifest marker missing"
[ "$(sudo sha256sum "$TARGET_RELEASE/.dashboard-production-candidate.json" | awk '{print $1}')" = "$EXPECTED_MANIFEST_SHA" ] || blocked "installed manifest SHA drift"
printf 'ISSUE126_ACTIVATION_RELEASE_APPLY_PASS %s\n' "$apply"

CURRENT_STAGE="restart-broker"
sudo /usr/bin/systemctl restart "$BROKER_SERVICE" || blocked "broker restart failed"
new_broker_pid="$(wait_broker_ready "$broker_pid" "$broker_nr")" || blocked "broker did not become application-ready on target release"
[ "$(unix_status "$BROKER_USER" "$BROKER_SOCKET" '/v1/health' 5)" = 200 ] || blocked "new broker health not 200"
[ "$(unix_status "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/containers' 12)" = 200 ] || blocked "new broker Docker not 200"
[ "$(unix_status "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/logs/homeassistant/15m' 8)" = 200 ] || blocked "new broker logs not 200"
now_epoch="$(date +%s)"; since_epoch="$((now_epoch - 60))"
[ "$(unix_status "$BROKER_USER" "$BROKER_SOCKET" "/v1/docker/events/recent?since=$since_epoch&until=$now_epoch" 8)" = 200 ] || blocked "new broker events not 200"
[ "$(unix_status "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/events' 5 || true)" = 404 ] || blocked "forbidden broker events path exposed"
printf 'ISSUE126_ACTIVATION_BROKER_PASS pid=%s nrestarts=%s docker=200 logs=200 events=200\n' "$new_broker_pid" "$broker_nr"

CURRENT_STAGE="restart-agent"
sudo /usr/bin/systemctl restart "$AGENT_SERVICE" || blocked "agent restart failed"
new_agent_pid="$(wait_agent_ready "$agent_pid" "$agent_nr")" || blocked "agent did not become application-ready on target release"
proc_has_gid "$new_agent_pid" "$broker_gid" || blocked "new agent broker-client group missing"
if proc_has_gid "$new_agent_pid" "$docker_gid"; then blocked "new agent gained Docker group"; fi
if proc_has_gid "$new_agent_pid" "$video_gid"; then blocked "new agent gained video group"; fi
[ "$(unix_status "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary' 5)" = 200 ] || blocked "new agent host not 200"
[ "$(unix_status "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' 12)" = 200 ] || blocked "new agent Docker not 200"
[ "$(unix_status "$WEB_USER" "$AGENT_SOCKET" '/v1/logs?sourceId=docker%3Ahomeassistant&range=15m' 8)" = 200 ] || blocked "new agent logs not 200"
[ "$(unix_status "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' 5)" = 200 ] || blocked "new agent Quick Commands not 200"
[ "$(unix_status "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' 8)" = 200 ] || blocked "new agent events not 200"
printf 'ISSUE126_ACTIVATION_AGENT_PASS pid=%s nrestarts=%s host=200 docker=200 logs=200 quick=200 events=200 docker_group=absent video_group=absent\n' "$new_agent_pid" "$agent_nr"

CURRENT_STAGE="restart-web"
sudo /usr/bin/systemctl restart "$WEB_SERVICE" || blocked "web restart failed"
new_web_pid="$(wait_web_ready "$web_pid" "$web_nr")" || blocked "web did not become application-ready on target release"
[ "$(loopback_status '/api/health' 5)" = 200 ] || blocked "new web health not 200"
[ "$(loopback_status '/api/current/host' 5)" = 200 ] || blocked "new web host not 200"
[ "$(loopback_status '/api/current/docker' 12)" = 200 ] || blocked "new web Docker not 200"
[ "$(loopback_status '/api/quick-commands' 5)" = 200 ] || blocked "new web Quick Commands not 200"
[ "$(loopback_status '/api/activity' 12)" = 200 ] || blocked "new web Activity not 200"
[ ! -S "$TERMINAL_SOCKET" ] || blocked "terminal socket appeared"
assert_access_302
printf 'ISSUE126_ACTIVATION_WEB_PASS pid=%s nrestarts=%s health=200 host=200 docker=200 quick=200 activity=200 terminal=absent access=302\n' "$new_web_pid" "$web_nr"

CURRENT_STAGE="final-acceptance"
[ "$(readlink "$CURRENT_LINK")" = "releases/$TARGET" ] || blocked "final current pointer drift"
[ "$(service_cwd "$BROKER_SERVICE" "$new_broker_pid")" = "$TARGET_RELEASE" ] || blocked "final broker cwd drift"
[ "$(service_cwd "$AGENT_SERVICE" "$new_agent_pid")" = "$TARGET_RELEASE" ] || blocked "final agent cwd drift"
[ "$(service_cwd "$WEB_SERVICE" "$new_web_pid")" = "$TARGET_RELEASE" ] || blocked "final web cwd drift"
[ "$(service_restarts "$BROKER_SERVICE")" = "$broker_nr" ] || blocked "final broker NRestarts drift"
[ "$(service_restarts "$AGENT_SERVICE")" = "$agent_nr" ] || blocked "final agent NRestarts drift"
[ "$(service_restarts "$WEB_SERVICE")" = "$web_nr" ] || blocked "final web NRestarts drift"
[ "$(unix_status "$BROKER_USER" "$BROKER_SOCKET" "/v1/docker/events/recent?since=$since_epoch&until=$now_epoch" 8)" = 200 ] || blocked "final broker events not 200"
[ "$(unix_status "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' 8)" = 200 ] || blocked "final agent events not 200"
[ "$(loopback_status '/api/activity' 12)" = 200 ] || blocked "final Activity not 200"
[ ! -S "$TERMINAL_SOCKET" ] || blocked "final terminal socket appeared"
assert_access_302
printf 'ISSUE126_PRODUCTION_ACTIVATION_PASS target=%s candidate=%s previous=%s broker_pid=%s agent_pid=%s web_pid=%s host=200 docker=200 logs=200 quick=200 events=200 activity=200 terminal=absent access=302\n' \
  "$TARGET" "$EXPECTED_CANDIDATE" "$EXPECTED_CURRENT" "$new_broker_pid" "$new_agent_pid" "$new_web_pid"
printf 'ISSUE126_ACTIVATION_STOP AUTHORIZATION_CONSUMED=YES AUTO_RETRY=NO AUTO_ROLLBACK=NO AUTO_CLEANUP=NO SYSTEMD_UNIT_MUTATION=NO IDENTITY_MUTATION=NO PERMISSION_WIDENING=NO CLOUDFLARE_MUTATION=NO TERMINAL_MUTATION=NO ACTIONS_MUTATION=NO\n'