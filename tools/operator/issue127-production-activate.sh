#!/usr/bin/env bash
set -Eeuo pipefail

TARGET="4295c23de5634dcb86b5fe9f57be92416eb9a75b"
EXPECTED_TREE="df24c7e8e2047176c43f24989e4910a30fa1bc02"
EXPECTED_CURRENT="15f44e3a6fdda8f2e97b26501a283f6bba915e86"
EXPECTED_CURRENT_CANDIDATE="1d9c27a9c2ac2370bc626807e14c5786de58671b6547dfc2f5c822efa45e0a2e"
EXPECTED_BROKER_RELEASE="a53fb31c33d872ec4b434d5c999d5469e1989f14"
EXPECTED_CI_RUN_ID="32278079231"
EXPECTED_CI_RUN_NUMBER="318"
EXPECTED_CI_RUN_ATTEMPT="2"
EXPECTED_CHECK_JOB_ID="96174756688"
EXPECTED_CANDIDATE="f08677aef82d0213422a171b51efd46fa7db57b29385fdd9c5d185f2c7b83eb0"
EXPECTED_MANIFEST_SHA="5e7ed7f70987f93291567b880053a1f46d911f51ce678690fd61bc9f097c60ff"
EXPECTED_FILES="61"
EXPECTED_BYTES="6531049"
EXPECTED_BROKER_ENTRY_SHA="a9fdbf13c704b0c9bc1d03ec5698198630a967d282644fb3440dfab2ff8de05d"
EXPECTED_AGENT_ENTRY_SHA="b44522f3998e723e7cea1a6ab136e0f57933f05925027365fc2cbda0ef47f56d"
EXPECTED_SERVER_DIST_SHA="bf5af5080c552f460123a39c23da66053319052297401740b9037fda84af8c6e"
EXPECTED_BROKER_PID="1760676"
EXPECTED_AGENT_PID="3482974"
EXPECTED_WEB_PID="3378022"
EXPECTED_OWNER_ACK="I_AUTHORIZE_ISSUE127_DOCKER_LOGS_PRODUCTION_ACTIVATION_F08677AEF82D0213422A171B51EFD46FA7DB57B29385FDD9C5D185F2C7B83EB0"
RELEASE_CONTROLLER_ACK="I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ACTIVATION"

REPO_SLUG="rozkalnsandris/dashboard_RPi5"
PROD_ROOT="/opt/dashboard_RPi5"
CURRENT_RELEASE="$PROD_ROOT/releases/$EXPECTED_CURRENT"
TARGET_RELEASE="$PROD_ROOT/releases/$TARGET"
LOCK_PATH="$PROD_ROOT/.dashboard-release-controller.lock"
WORKSPACE="$HOME/.cache/dashboard-rpi5-candidate-recovery/${TARGET}-issue127-ci318-a2"
REPO="$WORKSPACE/repo"
MANIFEST="$WORKSPACE/production-candidate.json"

BROKER_SERVICE="dashboard-rpi5-docker-broker.service"
AGENT_SERVICE="dashboard-rpi5-agent.service"
WEB_SERVICE="dashboard-rpi5-web.service"
BROKER_USER="dashboard-rpi5-docker-broker"
BROKER_GROUP="dashboard-rpi5-docker-client"
AGENT_USER="dashboard-rpi5-agent"
WEB_USER="dashboard-rpi5-web"
BROKER_UNIT="/etc/systemd/system/$BROKER_SERVICE"
AGENT_UNIT="/etc/systemd/system/$AGENT_SERVICE"
WEB_UNIT="/etc/systemd/system/$WEB_SERVICE"
BROKER_SOCKET="/run/dashboard-rpi5-docker-broker/broker.sock"
AGENT_SOCKET="/run/dashboard-rpi5/agent.sock"
TERMINAL_SOCKET="/run/dashboard-rpi5-terminal.sock"
QUICK_DROPIN="/etc/systemd/system/dashboard-rpi5-agent.service.d/10-quick-commands.conf"

MODE=""
MUTATION_STARTED="NO"
CURRENT_STAGE="argument-parse"

stop() {
  echo "ISSUE127_ACTIVATION_BLOCKED stage=$CURRENT_STAGE reason=$*" >&2
  exit 1
}

on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ "$MUTATION_STARTED" = "YES" ]; then
      echo "ISSUE127_ACTIVATION_EXIT=$rc MUTATION_STARTED=YES AUTHORIZATION_CONSUMED=YES AUTO_RETRY=NO AUTO_ROLLBACK=NO AUTO_CLEANUP=NO SYSTEMD_UNIT_MUTATION=NO IDENTITY_MUTATION=NO PERMISSION_MUTATION=NO CLOUDFLARE_MUTATION=NO TERMINAL_MUTATION=NO ACTIONS_MUTATION=NO" >&2
    else
      echo "ISSUE127_ACTIVATION_EXIT=$rc MUTATION_STARTED=NO AUTHORIZATION_CONSUMED=NO PRODUCTION_MUTATION=NO AUTO_RETRY=NO AUTO_CLEANUP=NO" >&2
    fi
  fi
}
trap on_exit EXIT

need() {
  command -v "$1" >/dev/null 2>&1 || stop "missing command: $1"
}

for command_name in curl jq git node sha256sum systemctl readlink stat id getent grep awk sed sudo tail tr sleep find sort xargs; do
  need "$command_name"
done

[ "$(id -u)" -ne 0 ] || stop "run as normal operator, not root"
[ "$(node -p 'process.versions.node.split(".")[0]')" = 24 ] || stop "Node major is not 24"

if [ "$#" -eq 1 ] && [ "$1" = "--preflight-only" ]; then
  MODE="preflight"
elif [ "$#" -eq 2 ] && [ "$1" = "--owner-ack" ]; then
  MODE="activate"
  [ "$2" = "$EXPECTED_OWNER_ACK" ] || stop "owner acknowledgement mismatch"
else
  stop "usage: $0 --preflight-only | --owner-ack <exact-ack>"
fi

printf 'ISSUE127_ACTIVATION_START mode=%s target=%s candidate=%s current=%s workspace=%s\n' \
  "$MODE" "$TARGET" "$EXPECTED_CANDIDATE" "$EXPECTED_CURRENT" "$WORKSPACE"

response_status() { printf '%s' "$1" | tail -n 1; }
response_body() { printf '%s' "$1" | sed '$d'; }

unix_response() {
  local user="$1" socket="$2" path="$3" timeout="${4:-12}"
  sudo -u "$user" curl -sS --max-time "$timeout" \
    --unix-socket "$socket" \
    -H 'Accept: application/json' \
    -w $'\n%{http_code}' \
    "http://localhost$path"
}

unix_status_only() {
  local user="$1" socket="$2" path="$3" timeout="${4:-12}"
  sudo -u "$user" curl -sS --max-time "$timeout" \
    --unix-socket "$socket" \
    -o /dev/null \
    -w '%{http_code}' \
    "http://localhost$path"
}

loopback_response() {
  local path="$1" timeout="${2:-12}"
  curl -sS --max-time "$timeout" \
    -H 'Accept: application/json' \
    -w $'\n%{http_code}' \
    "http://127.0.0.1:8787$path"
}

proc_has_gid() {
  local pid="$1" gid="$2"
  sudo awk '/^Groups:/ { for (i=2; i<=NF; i++) if ($i == wanted) found=1 } END { exit(found ? 0 : 1) }' \
    wanted="$gid" "/proc/$pid/status"
}

access_probe() {
  curl -sS --max-time 10 -D - -o /dev/null \
    -w $'\nISSUE127_ACCESS_CODE:%{http_code}\n' \
    https://dash.rozkalns.net/
}

wait_service_active() {
  local service="$1" index
  for ((index=0; index<50; index+=1)); do
    [ "$(systemctl is-active "$service" 2>/dev/null || true)" = active ] && return 0
    sleep 0.2
  done
  return 1
}

wait_unix_status() {
  local user="$1" socket="$2" path="$3" expected="$4" timeout="$5" index response status
  for ((index=0; index<50; index+=1)); do
    response="$(unix_response "$user" "$socket" "$path" "$timeout" 2>/dev/null || true)"
    status="$(response_status "$response")"
    if [ "$status" = "$expected" ]; then
      printf '%s' "$response"
      return 0
    fi
    if [[ "$status" =~ ^[0-9]{3}$ ]] && [ "$status" != 000 ]; then
      return 2
    fi
    sleep 0.2
  done
  return 1
}

wait_unix_status_only() {
  local user="$1" socket="$2" path="$3" expected="$4" timeout="$5" index status
  for ((index=0; index<50; index+=1)); do
    status="$(unix_status_only "$user" "$socket" "$path" "$timeout" 2>/dev/null || true)"
    if [ "$status" = "$expected" ]; then return 0; fi
    if [[ "$status" =~ ^[0-9]{3}$ ]] && [ "$status" != 000 ]; then return 2; fi
    sleep 0.2
  done
  return 1
}

wait_loopback_status() {
  local path="$1" expected="$2" timeout="$3" index response status
  for ((index=0; index<50; index+=1)); do
    response="$(loopback_response "$path" "$timeout" 2>/dev/null || true)"
    status="$(response_status "$response")"
    if [ "$status" = "$expected" ]; then
      printf '%s' "$response"
      return 0
    fi
    if [[ "$status" =~ ^[0-9]{3}$ ]] && [ "$status" != 000 ]; then
      return 2
    fi
    sleep 0.2
  done
  return 1
}

validate_log_snapshot() {
  local body="$1" source="$2" range="$3"
  printf '%s' "$body" | jq -e --arg source "$source" --arg range "$range" '
    (.observedAt | type == "string" and length > 0)
    and (.source.sourceId == $source)
    and (.source.kind == "DOCKER")
    and (.source.rangeMode == "TIME")
    and (.range == $range)
    and (.rangeApplied == true)
    and (.entries | type == "array" and length <= 400)
    and (.truncated | type == "boolean")
  ' >/dev/null
}

validate_quick_catalog() {
  local body="$1"
  printf '%s' "$body" | jq -e '
    (.commands | type == "array")
    and (.commands | length == 4)
    and (([.commands[].id] | sort) == ["host.disk-root","host.failed-units","host.kernel","host.uptime"])
  ' >/dev/null
}

manifest_sha_for() {
  jq -er --arg path "$1" '.files[] | select(.path == $path) | .sha256' "$MANIFEST"
}

###############################################################################
# 1. Exact source + recovered main CI binding. Read-only.
###############################################################################

CURRENT_STAGE="preauth-github"
main_json="$(curl -fsSL \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/branches/main")" \
  || stop "GitHub main lookup failed"
[ "$(printf '%s' "$main_json" | jq -er '.commit.sha')" = "$TARGET" ] || stop "main SHA drift"
[ "$(printf '%s' "$main_json" | jq -er '.commit.commit.tree.sha')" = "$EXPECTED_TREE" ] || stop "main tree drift"

run_json="$(curl -fsSL \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/actions/runs/$EXPECTED_CI_RUN_ID")" \
  || stop "recovered CI lookup failed"
[ "$(printf '%s' "$run_json" | jq -er '.id')" = "$EXPECTED_CI_RUN_ID" ] || stop "CI run id drift"
[ "$(printf '%s' "$run_json" | jq -er '.run_number')" = "$EXPECTED_CI_RUN_NUMBER" ] || stop "CI run number drift"
[ "$(printf '%s' "$run_json" | jq -er '.run_attempt')" = "$EXPECTED_CI_RUN_ATTEMPT" ] || stop "CI attempt drift"
[ "$(printf '%s' "$run_json" | jq -er '.name')" = CI ] || stop "CI workflow name drift"
[ "$(printf '%s' "$run_json" | jq -er '.event')" = push ] || stop "CI event drift"
[ "$(printf '%s' "$run_json" | jq -er '.head_branch')" = main ] || stop "CI branch drift"
[ "$(printf '%s' "$run_json" | jq -er '.head_sha')" = "$TARGET" ] || stop "CI source SHA drift"
[ "$(printf '%s' "$run_json" | jq -er '.status')" = completed ] || stop "CI not completed"
[ "$(printf '%s' "$run_json" | jq -er '.conclusion')" = success ] || stop "CI not successful"

jobs_json="$(curl -fsSL \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/actions/runs/$EXPECTED_CI_RUN_ID/jobs?filter=latest&per_page=100")" \
  || stop "recovered CI jobs lookup failed"

check_count="$(printf '%s' "$jobs_json" | jq -er --argjson id "$EXPECTED_CHECK_JOB_ID" '
  [.jobs[] | select(.id == $id and .name == "check" and .status == "completed" and .conclusion == "success")] | length
')"
[ "$check_count" -eq 1 ] || stop "recovered check job identity/success mismatch"
for step_name in "Install Chromium" "Responsive browser tests"; do
  step_count="$(printf '%s' "$jobs_json" | jq -er --argjson id "$EXPECTED_CHECK_JOB_ID" --arg step "$step_name" '
    [.jobs[] | select(.id == $id) | .steps[]? | select(.name == $step and .status == "completed" and .conclusion == "success")] | length
  ')"
  [ "$step_count" -eq 1 ] || stop "recovered check step not success: $step_name"
done
for job_name in "terminal-native (x64)" "terminal-native (arm64)"; do
  count="$(printf '%s' "$jobs_json" | jq -er --arg name "$job_name" '
    [.jobs[] | select(.name == $name and .status == "completed" and .conclusion == "success")] | length
  ')"
  [ "$count" -eq 1 ] || stop "required native CI job not success: $job_name count=$count"
done
printf 'ISSUE127_ACTIVATION_EXACT_CI_PASS run=%s attempt=%s run_id=%s check_job=%s\n' \
  "$EXPECTED_CI_RUN_NUMBER" "$EXPECTED_CI_RUN_ATTEMPT" "$EXPECTED_CI_RUN_ID" "$EXPECTED_CHECK_JOB_ID"

###############################################################################
# 2. Bind immutable prepared candidate and merged #127 trust-boundary contract.
###############################################################################

CURRENT_STAGE="preauth-candidate"
[ -d "$WORKSPACE" ] || stop "prepared candidate workspace missing"
[ -d "$REPO/.git" ] || stop "prepared candidate repository missing"
[ -f "$MANIFEST" ] || stop "prepared candidate manifest missing"
[ "$(git -C "$REPO" rev-parse HEAD)" = "$TARGET" ] || stop "prepared repo HEAD drift"
[ "$(git -C "$REPO" rev-parse 'HEAD^{tree}')" = "$EXPECTED_TREE" ] || stop "prepared repo tree drift"
[ "$(sha256sum "$MANIFEST" | awk '{print $1}')" = "$EXPECTED_MANIFEST_SHA" ] || stop "manifest file digest drift"
[ "$(jq -er '.sourceSha' "$MANIFEST")" = "$TARGET" ] || stop "manifest source drift"
[ "$(jq -er '.candidateSha256' "$MANIFEST")" = "$EXPECTED_CANDIDATE" ] || stop "candidate digest drift"
[ "$(jq -er '.fileCount' "$MANIFEST")" = "$EXPECTED_FILES" ] || stop "candidate file count drift"
[ "$(jq -er '.totalBytes' "$MANIFEST")" = "$EXPECTED_BYTES" ] || stop "candidate byte count drift"

node "$REPO/tools/production-candidate-manifest.mjs" \
  --root "$REPO" --sha "$TARGET" --verify "$MANIFEST" \
  | grep -q '"status":"PASS"' || stop "candidate manifest verification failed"

[ "$(sha256sum "$REPO/apps/agent/dist/docker-broker-entry.js" | awk '{print $1}')" = "$EXPECTED_BROKER_ENTRY_SHA" ] \
  || stop "candidate broker entry drift"
[ "$(sha256sum "$REPO/apps/agent/dist/index.js" | awk '{print $1}')" = "$EXPECTED_AGENT_ENTRY_SHA" ] \
  || stop "candidate agent entry drift"
server_dist_sha="$(find "$REPO/apps/server/dist" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')"
[ "$server_dist_sha" = "$EXPECTED_SERVER_DIST_SHA" ] || stop "candidate server dist drift"

protocol="$REPO/apps/agent/src/docker-broker-protocol.ts"
broker_server="$REPO/apps/agent/src/docker-broker-server.ts"
live_logs="$REPO/apps/agent/src/docker-logs-live.ts"
grep -qF 'export const DOCKER_BROKER_LOG_MAX_RESPONSE_BYTES = 512 * 1024;' "$protocol" || stop "Docker log response bound drift"
grep -qF 'export const DOCKER_BROKER_LOG_TAIL = 400;' "$protocol" || stop "Docker log tail drift"
grep -qF 'export const DOCKER_BROKER_LOG_SOURCES = ["homeassistant", "prometheus"] as const;' "$protocol" || stop "Docker log source allowlist drift"
grep -qF 'export const DOCKER_BROKER_LOG_RANGES = ["15m", "1h", "6h", "24h"] as const;' "$protocol" || stop "Docker log range allowlist drift"
grep -qF 'logs?stdout=true&stderr=true&since=${sinceSeconds}&timestamps=true&tail=${DOCKER_BROKER_LOG_TAIL}' "$broker_server" || stop "broker Docker log query drift"
grep -qF '"docker:homeassistant": { brokerSource: "homeassistant", containerName: "homeassistant" }' "$live_logs" || stop "Home Assistant live mapping drift"
grep -qF '"docker:prometheus": { brokerSource: "prometheus", containerName: "prometheus" }' "$live_logs" || stop "Prometheus live mapping drift"

broker_unit_sha="$(manifest_sha_for 'ops/systemd/dashboard-rpi5-docker-broker.service')"
agent_unit_sha="$(manifest_sha_for 'ops/systemd/dashboard-rpi5-agent.service')"
web_unit_sha="$(manifest_sha_for 'ops/systemd/dashboard-rpi5-web.service')"
printf 'ISSUE127_ACTIVATION_CANDIDATE_PASS candidate=%s manifest=%s files=%s bytes=%s broker_entry=%s agent_entry=%s server_dist=%s\n' \
  "$EXPECTED_CANDIDATE" "$EXPECTED_MANIFEST_SHA" "$EXPECTED_FILES" "$EXPECTED_BYTES" \
  "$EXPECTED_BROKER_ENTRY_SHA" "$EXPECTED_AGENT_ENTRY_SHA" "$EXPECTED_SERVER_DIST_SHA"

###############################################################################
# 3. Fresh production baseline immediately before authorization. Read-only.
###############################################################################

CURRENT_STAGE="preauth-production"
[ "$(readlink "$PROD_ROOT/current")" = "releases/$EXPECTED_CURRENT" ] || stop "current pointer drift"
[ -d "$CURRENT_RELEASE" ] || stop "current production release missing"
[ ! -e "$TARGET_RELEASE" ] || stop "target release already exists before authorization"
[ ! -e "$LOCK_PATH" ] || stop "release-controller lock exists"

CURRENT_MANIFEST="$CURRENT_RELEASE/.dashboard-production-candidate.json"
[ -f "$CURRENT_MANIFEST" ] || stop "current immutable manifest missing"
sudo /usr/bin/node "$CURRENT_RELEASE/tools/production-candidate-manifest.mjs" \
  --root "$CURRENT_RELEASE" --sha "$EXPECTED_CURRENT" --verify "$CURRENT_MANIFEST" \
  | grep -q '"status":"PASS"' || stop "current immutable manifest verification failed"
[ "$(sudo jq -er '.candidateSha256' "$CURRENT_MANIFEST")" = "$EXPECTED_CURRENT_CANDIDATE" ] || stop "current candidate digest drift"

for service_name in "$BROKER_SERVICE" "$AGENT_SERVICE" "$WEB_SERVICE"; do
  [ "$(systemctl is-active "$service_name")" = active ] || stop "$service_name not active"
  [ "$(systemctl is-enabled "$service_name")" = enabled ] || stop "$service_name not enabled"
  [ "$(systemctl show "$service_name" -p NRestarts --value)" = 0 ] || stop "$service_name NRestarts drift"
done

broker_pid="$(systemctl show "$BROKER_SERVICE" -p MainPID --value)"
agent_pid="$(systemctl show "$AGENT_SERVICE" -p MainPID --value)"
web_pid="$(systemctl show "$WEB_SERVICE" -p MainPID --value)"
[ "$broker_pid" = "$EXPECTED_BROKER_PID" ] || stop "broker PID drift expected=$EXPECTED_BROKER_PID actual=$broker_pid"
[ "$agent_pid" = "$EXPECTED_AGENT_PID" ] || stop "agent PID drift expected=$EXPECTED_AGENT_PID actual=$agent_pid"
[ "$web_pid" = "$EXPECTED_WEB_PID" ] || stop "web PID drift expected=$EXPECTED_WEB_PID actual=$web_pid"
[ "$(sudo readlink -f "/proc/$broker_pid/cwd")" = "$PROD_ROOT/releases/$EXPECTED_BROKER_RELEASE" ] || stop "broker cwd drift"
[ "$(sudo readlink -f "/proc/$agent_pid/cwd")" = "$CURRENT_RELEASE" ] || stop "agent cwd drift"
[ "$(sudo readlink -f "/proc/$web_pid/cwd")" = "$CURRENT_RELEASE" ] || stop "web cwd drift"

[ "$(sudo sha256sum "$BROKER_UNIT" | awk '{print $1}')" = "$broker_unit_sha" ] || stop "installed broker unit differs from target"
[ "$(sudo sha256sum "$AGENT_UNIT" | awk '{print $1}')" = "$agent_unit_sha" ] || stop "installed agent unit differs from target"
[ "$(sudo sha256sum "$WEB_UNIT" | awk '{print $1}')" = "$web_unit_sha" ] || stop "installed web unit differs from target"

[ -f "$QUICK_DROPIN" ] || stop "Quick Commands drop-in missing"
expected_quick_dropin="$(printf '[Service]\nEnvironment=DASHBOARD_RPI5_QUICK_COMMANDS=enabled\n')"
actual_quick_dropin="$(sudo cat "$QUICK_DROPIN")" || stop "Quick Commands drop-in unreadable"
[ "$actual_quick_dropin" = "$expected_quick_dropin" ] || stop "Quick Commands drop-in bytes drift"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$QUICK_DROPIN")" = 'root:root:644:regular file' ] || stop "Quick Commands drop-in metadata drift"
agent_env="$(systemctl show "$AGENT_SERVICE" -p Environment --value)"
printf '%s\n' "$agent_env" | grep -q 'DASHBOARD_RPI5_QUICK_COMMANDS=enabled' || stop "Quick Commands effective environment not enabled"

broker_gid="$(getent group "$BROKER_GROUP" | awk -F: '{print $3}')"
docker_gid="$(getent group docker | awk -F: '{print $3}')"
video_gid="$(getent group video | awk -F: '{print $3}')"
[[ "$broker_gid" =~ ^[0-9]+$ ]] || stop "broker-client GID unavailable"
[[ "$docker_gid" =~ ^[0-9]+$ ]] || stop "Docker GID unavailable"
[[ "$video_gid" =~ ^[0-9]+$ ]] || stop "video GID unavailable"

for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then
    stop "main agent persistent group boundary violated: $forbidden_group"
  fi
done
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -Eq "^(docker|video|$BROKER_GROUP)$"; then stop "web persistent privilege group boundary violated"; fi
if id -nG "$BROKER_USER" | tr ' ' '\n' | grep -Eq '^(docker|video)$'; then stop "broker persistent privilege group boundary violated"; fi

proc_has_gid "$agent_pid" "$broker_gid" || stop "agent runtime broker-client group missing"
if proc_has_gid "$agent_pid" "$docker_gid"; then stop "agent runtime Docker group appeared"; fi
if proc_has_gid "$agent_pid" "$video_gid"; then stop "agent runtime video group appeared"; fi
proc_has_gid "$broker_pid" "$docker_gid" || stop "broker runtime Docker group missing"
if proc_has_gid "$broker_pid" "$video_gid"; then stop "broker runtime video group appeared"; fi

[ "$(sudo stat -Lc '%U:%G:%a:%F' /var/run/docker.sock)" = 'root:docker:660:socket' ] || stop "Docker socket metadata drift"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$BROKER_SOCKET")" = "$BROKER_USER:$BROKER_GROUP:660:socket" ] || stop "broker socket metadata drift"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$AGENT_SOCKET")" = 'dashboard-rpi5-agent:dashboard-rpi5-agent-client:660:socket' ] || stop "agent socket metadata drift"

broker_health="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/health' 5)" || stop "broker health probe failed"
[ "$(response_status "$broker_health")" = 200 ] || stop "broker health not 200"
broker_docker="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/containers' 12)" || stop "broker Docker current-state probe failed"
[ "$(response_status "$broker_docker")" = 200 ] || stop "broker Docker current-state not 200"
for path in '/v1/docker/logs/homeassistant/15m' '/v1/docker/logs/prometheus/24h'; do
  [ "$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" "$path" 5 || true)" = 404 ] || stop "old broker unexpectedly exposes #127 route: $path"
done

agent_health="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/health' 5)" || stop "agent health probe failed"
[ "$(response_status "$agent_health")" = 200 ] || stop "agent health not 200"
agent_host="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary' 5)" || stop "agent host probe failed"
[ "$(response_status "$agent_host")" = 200 ] || stop "agent host not 200"
agent_docker="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' 12)" || stop "agent Docker probe failed"
[ "$(response_status "$agent_docker")" = 200 ] || stop "agent Docker current-state not 200"
for source_id in 'docker%3Ahomeassistant' 'docker%3Aprometheus'; do
  logs_probe="$(unix_response "$WEB_USER" "$AGENT_SOCKET" "/v1/logs?sourceId=$source_id&range=15m" 8 || true)"
  [ "$(response_status "$logs_probe")" = 503 ] || stop "Docker logs should remain 503 before #127 activation"
done
events_probe="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' 5 || true)"
[ "$(response_status "$events_probe")" = 503 ] || stop "Docker events should remain 503 pending #126"
quick_probe="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' 5)" || stop "Quick Commands probe failed"
[ "$(response_status "$quick_probe")" = 200 ] || stop "Quick Commands not 200"
validate_quick_catalog "$(response_body "$quick_probe")" || stop "Quick Commands catalog drift"
[ ! -S "$TERMINAL_SOCKET" ] || stop "terminal/PTTY socket unexpectedly exists"

for source_id in 'docker%3Ahomeassistant' 'docker%3Aprometheus'; do
  web_logs_before="$(loopback_response "/api/logs?sourceId=$source_id&range=15m" 8 || true)"
  [ "$(response_status "$web_logs_before")" = 503 ] || stop "web Docker logs should remain 503 before #127 activation"
done

access_before="$(access_probe)" || stop "Cloudflare Access preflight failed"
printf '%s' "$access_before" | grep -q 'ISSUE127_ACCESS_CODE:302' || stop "Cloudflare Access expected 302"
printf '%s' "$access_before" | grep -qi '^www-authenticate:.*cloudflare-access' || stop "Cloudflare Access marker missing"

###############################################################################
# 4. Exact release PLAN at the authorization boundary. Read-only.
###############################################################################

CURRENT_STAGE="preauth-release-plan"
plan="$(cd "$REPO" && sudo /usr/bin/node tools/production-release-controller.mjs \
  --candidate-root "$REPO" --manifest "$MANIFEST" --sha "$TARGET")" \
  || stop "release-controller PLAN failed"
[ "$(printf '%s' "$plan" | jq -er '.status')" = PLAN ] || stop "release PLAN status mismatch"
[ "$(printf '%s' "$plan" | jq -er '.action')" = activate ] || stop "release PLAN action mismatch"
[ "$(printf '%s' "$plan" | jq -er '.sourceSha')" = "$TARGET" ] || stop "release PLAN source mismatch"
[ "$(printf '%s' "$plan" | jq -er '.candidateSha256')" = "$EXPECTED_CANDIDATE" ] || stop "release PLAN candidate mismatch"
[ "$(printf '%s' "$plan" | jq -er '.observedCurrent')" = "$EXPECTED_CURRENT" ] || stop "release PLAN current mismatch"
[ "$(printf '%s' "$plan" | jq -er '.targetRelease')" = absent ] || stop "release target should be absent"
[ "$(printf '%s' "$plan" | jq -c '.operations')" = '["copy_manifest_allowlisted_release","write_verified_manifest_marker","atomic_current_symlink_swap"]' ] \
  || stop "release PLAN operations mismatch"

printf 'ISSUE127_ACTIVATION_PREAUTH_PASS target=%s candidate=%s current=%s broker_pid=%s agent_pid=%s web_pid=%s broker=200 host=200 docker=200 docker_logs=503 events=503 quick=200 terminal=absent access=302\n' \
  "$TARGET" "$EXPECTED_CANDIDATE" "$EXPECTED_CURRENT" "$broker_pid" "$agent_pid" "$web_pid"

if [ "$MODE" = preflight ]; then
  echo "ISSUE127_ACTIVATION_PREFLIGHT_ONLY_STOP PRODUCTION_MUTATION=NO AUTHORIZATION_CONSUMED=NO RELEASE_APPLY=NO BROKER_RESTART=NO AGENT_RESTART=NO WEB_RESTART=NO SYSTEMD_UNIT_MUTATION=NO IDENTITY_MUTATION=NO PERMISSION_MUTATION=NO CLOUDFLARE_MUTATION=NO TERMINAL_MUTATION=NO ACTIONS_MUTATION=NO"
  exit 0
fi

###############################################################################
# 5. Mutation boundary. Owner acknowledgement was matched at argument parsing.
#    From the next line authorization is consumed. Any error => evidence + STOP.
###############################################################################

MUTATION_STARTED="YES"
CURRENT_STAGE="mutation-release-apply"
echo "ISSUE127_ACTIVATION_MUTATION_STARTED stage=$CURRENT_STAGE AUTHORIZATION_CONSUMED=YES"
apply="$(cd "$REPO" && sudo /usr/bin/node tools/production-release-controller.mjs \
  --candidate-root "$REPO" --manifest "$MANIFEST" --sha "$TARGET" \
  --expected-current "$EXPECTED_CURRENT" --apply --ack "$RELEASE_CONTROLLER_ACK")" \
  || stop "release APPLY failed"
[ "$(printf '%s' "$apply" | jq -er '.status')" = APPLIED ] || stop "release apply status mismatch"
[ "$(printf '%s' "$apply" | jq -er '.sourceSha')" = "$TARGET" ] || stop "release apply source mismatch"
[ "$(printf '%s' "$apply" | jq -er '.candidateSha256')" = "$EXPECTED_CANDIDATE" ] || stop "release apply candidate mismatch"
[ "$(printf '%s' "$apply" | jq -er '.previousRelease')" = "$EXPECTED_CURRENT" ] || stop "release apply previous release mismatch"
[ "$(printf '%s' "$apply" | jq -er '.currentRelease')" = "$TARGET" ] || stop "release apply current release mismatch"
[ "$(readlink "$PROD_ROOT/current")" = "releases/$TARGET" ] || stop "current pointer did not move to target"
[ -d "$TARGET_RELEASE" ] || stop "target release missing after apply"
[ ! -e "$LOCK_PATH" ] || stop "release-controller lock remains after apply"

sudo /usr/bin/node "$TARGET_RELEASE/tools/production-candidate-manifest.mjs" \
  --root "$TARGET_RELEASE" --sha "$TARGET" --verify "$TARGET_RELEASE/.dashboard-production-candidate.json" \
  | grep -q '"status":"PASS"' || stop "installed target manifest verification failed"
[ "$(sudo jq -er '.candidateSha256' "$TARGET_RELEASE/.dashboard-production-candidate.json")" = "$EXPECTED_CANDIDATE" ] \
  || stop "installed target candidate digest mismatch"

[ "$(systemctl show "$BROKER_SERVICE" -p MainPID --value)" = "$broker_pid" ] || stop "broker PID changed during release apply"
[ "$(systemctl show "$AGENT_SERVICE" -p MainPID --value)" = "$agent_pid" ] || stop "agent PID changed during release apply"
[ "$(systemctl show "$WEB_SERVICE" -p MainPID --value)" = "$web_pid" ] || stop "web PID changed during release apply"

###############################################################################
# 6. Broker cutover first: exactly one restart, then bounded route acceptance.
###############################################################################

CURRENT_STAGE="mutation-restart-broker"
sudo /usr/bin/systemctl restart "$BROKER_SERVICE" || stop "broker restart command failed"
wait_service_active "$BROKER_SERVICE" || stop "broker did not become active"
new_broker_pid="$(systemctl show "$BROKER_SERVICE" -p MainPID --value)"
[[ "$new_broker_pid" =~ ^[1-9][0-9]*$ ]] || stop "invalid new broker PID"
[ "$new_broker_pid" != "$broker_pid" ] || stop "broker PID did not change"
[ "$(sudo readlink -f "/proc/$new_broker_pid/cwd")" = "$TARGET_RELEASE" ] || stop "new broker cwd is not target release"
[ "$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)" = 0 ] || stop "broker NRestarts changed"

proc_has_gid "$new_broker_pid" "$docker_gid" || stop "new broker process missing Docker supplementary group"
if proc_has_gid "$new_broker_pid" "$video_gid"; then stop "new broker process unexpectedly has video group"; fi
if id -nG "$BROKER_USER" | tr ' ' '\n' | grep -Eq '^(docker|video)$'; then stop "broker persistent privilege group changed"; fi
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$BROKER_SOCKET")" = "$BROKER_USER:$BROKER_GROUP:660:socket" ] || stop "new broker socket metadata mismatch"

new_broker_health="$(wait_unix_status "$BROKER_USER" "$BROKER_SOCKET" '/v1/health' 200 5)" || stop "new broker health did not become 200"
new_broker_docker="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/containers' 12)" || stop "new broker Docker current-state failed"
[ "$(response_status "$new_broker_docker")" = 200 ] || stop "new broker Docker current-state not 200"
wait_unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/logs/homeassistant/15m' 200 12 || stop "Home Assistant broker log route did not become 200"
wait_unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/logs/prometheus/24h' 200 12 || stop "Prometheus broker log route did not become 200"
[ "$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/logs/homeassistant/7d' 5 || true)" = 404 ] || stop "broker accepted forbidden log range"
[ "$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/logs/unknown/15m' 5 || true)" = 404 ] || stop "broker accepted forbidden log source"
[ "$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/images/json' 5 || true)" = 404 ] || stop "broker arbitrary Docker path did not fail closed"
[ "$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/events' 5 || true)" = 404 ] || stop "broker Docker events path unexpectedly enabled"

echo "ISSUE127_ACTIVATION_BROKER_PASS broker_pid=$new_broker_pid docker=200 homeassistant_logs=200 prometheus_logs=200 forbidden_range=404 forbidden_source=404 arbitrary_path=404 events_path=404"

###############################################################################
# 7. Agent cutover only after broker acceptance: exactly one restart.
###############################################################################

CURRENT_STAGE="mutation-restart-agent"
sudo /usr/bin/systemctl restart "$AGENT_SERVICE" || stop "agent restart command failed"
wait_service_active "$AGENT_SERVICE" || stop "agent did not become active"
new_agent_health="$(wait_unix_status "$WEB_USER" "$AGENT_SOCKET" '/v1/health' 200 5)" || stop "new agent health did not become 200"
new_agent_pid="$(systemctl show "$AGENT_SERVICE" -p MainPID --value)"
[[ "$new_agent_pid" =~ ^[1-9][0-9]*$ ]] || stop "invalid new agent PID"
[ "$new_agent_pid" != "$agent_pid" ] || stop "agent PID did not change"
[ "$(sudo readlink -f "/proc/$new_agent_pid/cwd")" = "$TARGET_RELEASE" ] || stop "new agent cwd is not target release"
[ "$(systemctl show "$AGENT_SERVICE" -p NRestarts --value)" = 0 ] || stop "agent NRestarts changed"

proc_has_gid "$new_agent_pid" "$broker_gid" || stop "new agent missing runtime broker-client group"
if proc_has_gid "$new_agent_pid" "$docker_gid"; then stop "new agent unexpectedly has Docker group"; fi
if proc_has_gid "$new_agent_pid" "$video_gid"; then stop "new agent unexpectedly has video group"; fi
for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then
    stop "main agent acquired forbidden persistent group: $forbidden_group"
  fi
done

new_agent_host="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary' 5)" || stop "new agent host probe failed"
[ "$(response_status "$new_agent_host")" = 200 ] || stop "new agent host not 200"
new_agent_docker="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' 12)" || stop "new agent Docker current-state probe failed"
[ "$(response_status "$new_agent_docker")" = 200 ] || stop "new agent Docker current-state not 200"

for pair in 'docker%3Ahomeassistant|docker:homeassistant' 'docker%3Aprometheus|docker:prometheus'; do
  encoded="${pair%%|*}"
  source="${pair#*|}"
  response="$(unix_response "$WEB_USER" "$AGENT_SOCKET" "/v1/logs?sourceId=$encoded&range=15m" 12)" || stop "agent Docker logs transport failed: $source"
  [ "$(response_status "$response")" = 200 ] || stop "agent Docker logs not 200: $source"
  validate_log_snapshot "$(response_body "$response")" "$source" "15m" || stop "agent Docker log snapshot invalid: $source"
done

new_events="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' 5 || true)"
[ "$(response_status "$new_events")" = 503 ] || stop "Docker events should remain 503 pending #126"
new_quick="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' 5)" || stop "Quick Commands post-agent probe failed"
[ "$(response_status "$new_quick")" = 200 ] || stop "Quick Commands changed after agent cutover"
validate_quick_catalog "$(response_body "$new_quick")" || stop "Quick Commands catalog changed after agent cutover"
[ ! -S "$TERMINAL_SOCKET" ] || stop "terminal/PTTY socket appeared after agent cutover"

access_mid="$(access_probe)" || stop "Cloudflare Access probe failed after agent cutover"
printf '%s' "$access_mid" | grep -q 'ISSUE127_ACCESS_CODE:302' || stop "Cloudflare Access changed after agent cutover"
printf '%s' "$access_mid" | grep -qi '^www-authenticate:.*cloudflare-access' || stop "Cloudflare Access marker missing after agent cutover"

echo "ISSUE127_ACTIVATION_AGENT_PASS agent_pid=$new_agent_pid host=200 docker=200 homeassistant_logs=200 prometheus_logs=200 events=503 quick=200 terminal=absent access=302"

###############################################################################
# 8. Web cutover only after broker + agent acceptance: exactly one restart.
###############################################################################

CURRENT_STAGE="mutation-restart-web"
sudo /usr/bin/systemctl restart "$WEB_SERVICE" || stop "web restart command failed"
wait_service_active "$WEB_SERVICE" || stop "web did not become active"
web_health="$(wait_loopback_status '/api/health' 200 5)" || stop "web health did not become 200"
new_web_pid="$(systemctl show "$WEB_SERVICE" -p MainPID --value)"
[[ "$new_web_pid" =~ ^[1-9][0-9]*$ ]] || stop "invalid new web PID"
[ "$new_web_pid" != "$web_pid" ] || stop "web PID did not change"
[ "$(sudo readlink -f "/proc/$new_web_pid/cwd")" = "$TARGET_RELEASE" ] || stop "new web cwd is not target release"
[ "$(systemctl show "$WEB_SERVICE" -p NRestarts --value)" = 0 ] || stop "web NRestarts changed"
if proc_has_gid "$new_web_pid" "$broker_gid"; then stop "web process unexpectedly has broker-client group"; fi
if proc_has_gid "$new_web_pid" "$docker_gid"; then stop "web process unexpectedly has Docker group"; fi
if proc_has_gid "$new_web_pid" "$video_gid"; then stop "web process unexpectedly has video group"; fi
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -Eq "^(docker|video|$BROKER_GROUP)$"; then stop "web persistent privilege group changed"; fi

web_root="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/)" || stop "web root probe failed"
[ "$web_root" = 200 ] || stop "web root not 200"
web_host="$(loopback_response '/api/current/host' 5)" || stop "web host current-state probe failed"
[ "$(response_status "$web_host")" = 200 ] || stop "web host current-state not 200"
web_docker="$(loopback_response '/api/current/docker' 12)" || stop "web Docker current-state probe failed"
[ "$(response_status "$web_docker")" = 200 ] || stop "web Docker current-state not 200"

for pair in 'docker%3Ahomeassistant|docker:homeassistant' 'docker%3Aprometheus|docker:prometheus'; do
  encoded="${pair%%|*}"
  source="${pair#*|}"
  response="$(loopback_response "/api/logs?sourceId=$encoded&range=15m" 12)" || stop "web Docker logs transport failed: $source"
  [ "$(response_status "$response")" = 200 ] || stop "web Docker logs not 200: $source"
  validate_log_snapshot "$(response_body "$response")" "$source" "15m" || stop "web Docker log snapshot invalid: $source"
done

echo "ISSUE127_ACTIVATION_WEB_PASS web_pid=$new_web_pid root=200 host=200 docker=200 homeassistant_logs=200 prometheus_logs=200"

###############################################################################
# 9. Final immutable + trust-boundary proof. Read-only.
###############################################################################

CURRENT_STAGE="postmutation-final-proof"
[ "$(readlink "$PROD_ROOT/current")" = "releases/$TARGET" ] || stop "final current pointer drift"
[ -d "$TARGET_RELEASE" ] || stop "final target release missing"
[ ! -e "$LOCK_PATH" ] || stop "final release-controller lock exists"
for service_name in "$BROKER_SERVICE" "$AGENT_SERVICE" "$WEB_SERVICE"; do
  [ "$(systemctl is-active "$service_name")" = active ] || stop "$service_name not active at final proof"
  [ "$(systemctl is-enabled "$service_name")" = enabled ] || stop "$service_name not enabled at final proof"
  [ "$(systemctl show "$service_name" -p NRestarts --value)" = 0 ] || stop "$service_name NRestarts not zero at final proof"
done
[ "$(sudo readlink -f "/proc/$new_broker_pid/cwd")" = "$TARGET_RELEASE" ] || stop "final broker cwd drift"
[ "$(sudo readlink -f "/proc/$new_agent_pid/cwd")" = "$TARGET_RELEASE" ] || stop "final agent cwd drift"
[ "$(sudo readlink -f "/proc/$new_web_pid/cwd")" = "$TARGET_RELEASE" ] || stop "final web cwd drift"

[ "$(sudo sha256sum "$BROKER_UNIT" | awk '{print $1}')" = "$broker_unit_sha" ] || stop "final broker unit drift"
[ "$(sudo sha256sum "$AGENT_UNIT" | awk '{print $1}')" = "$agent_unit_sha" ] || stop "final agent unit drift"
[ "$(sudo sha256sum "$WEB_UNIT" | awk '{print $1}')" = "$web_unit_sha" ] || stop "final web unit drift"
[ "$(sudo stat -Lc '%U:%G:%a:%F' /var/run/docker.sock)" = 'root:docker:660:socket' ] || stop "Docker socket metadata changed"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$BROKER_SOCKET")" = "$BROKER_USER:$BROKER_GROUP:660:socket" ] || stop "final broker socket metadata drift"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$AGENT_SOCKET")" = 'dashboard-rpi5-agent:dashboard-rpi5-agent-client:660:socket' ] || stop "final agent socket metadata drift"

for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then stop "final main agent persistent group boundary violated: $forbidden_group"; fi
done
if id -nG "$BROKER_USER" | tr ' ' '\n' | grep -Eq '^(docker|video)$'; then stop "final broker persistent group boundary violated"; fi
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -Eq "^(docker|video|$BROKER_GROUP)$"; then stop "final web persistent privilege group boundary violated"; fi
proc_has_gid "$new_agent_pid" "$broker_gid" || stop "final agent runtime broker-client group missing"
if proc_has_gid "$new_agent_pid" "$docker_gid"; then stop "final agent runtime Docker group appeared"; fi
if proc_has_gid "$new_agent_pid" "$video_gid"; then stop "final agent runtime video group appeared"; fi
proc_has_gid "$new_broker_pid" "$docker_gid" || stop "final broker runtime Docker group missing"

final_quick="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' 5)" || stop "final Quick Commands probe failed"
[ "$(response_status "$final_quick")" = 200 ] || stop "final Quick Commands not 200"
validate_quick_catalog "$(response_body "$final_quick")" || stop "final Quick Commands catalog drift"
final_events="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' 5 || true)"
[ "$(response_status "$final_events")" = 503 ] || stop "Docker events not 503 at final proof"
for pair in 'docker%3Ahomeassistant|docker:homeassistant' 'docker%3Aprometheus|docker:prometheus'; do
  encoded="${pair%%|*}"
  source="${pair#*|}"
  response="$(unix_response "$WEB_USER" "$AGENT_SOCKET" "/v1/logs?sourceId=$encoded&range=15m" 12)" || stop "final Docker logs transport failed: $source"
  [ "$(response_status "$response")" = 200 ] || stop "final Docker logs not 200: $source"
  validate_log_snapshot "$(response_body "$response")" "$source" "15m" || stop "final Docker log snapshot invalid: $source"
done
[ ! -S "$TERMINAL_SOCKET" ] || stop "terminal/PTTY socket present at final proof"

access_after="$(access_probe)" || stop "final Cloudflare Access probe failed"
printf '%s' "$access_after" | grep -q 'ISSUE127_ACCESS_CODE:302' || stop "final Cloudflare Access not 302"
printf '%s' "$access_after" | grep -qi '^www-authenticate:.*cloudflare-access' || stop "final Cloudflare Access marker missing"

echo "ISSUE127_ACTIVATION_PASS target=$TARGET candidate=$EXPECTED_CANDIDATE previous=$EXPECTED_CURRENT current=$TARGET broker_pid=$new_broker_pid agent_pid=$new_agent_pid web_pid=$new_web_pid host=200 docker=200 homeassistant_logs=200 prometheus_logs=200 events=503 quick=200 terminal=absent access=302"
echo "ISSUE127_ACTIVATION_FINAL production_deploy=YES docker_logs=ACTIVE bounded_docker_broker=ACTIVE broker_restart=ONE agent_restart=ONE web_restart=ONE systemd_unit_mutation=NO identity_mutation=NO permission_mutation=NO main_agent_docker_group=NO main_agent_video_group=NO cloudflare=UNCHANGED terminal=absent"
