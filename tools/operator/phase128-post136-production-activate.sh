#!/usr/bin/env bash
set -Eeuo pipefail

TARGET="15f44e3a6fdda8f2e97b26501a283f6bba915e86"
EXPECTED_CURRENT="a53fb31c33d872ec4b434d5c999d5469e1989f14"
OLD_WEB_RELEASE="73c51f3446395c51ea010831c4614777264fae3e"
EXPECTED_CI_RUN="305"
EXPECTED_CI_RUN_ID="32177354491"
EXPECTED_CANDIDATE="1d9c27a9c2ac2370bc626807e14c5786de58671b6547dfc2f5c822efa45e0a2e"
EXPECTED_MANIFEST_SHA="2cc46ad30787355eead24aab90d769cd8cf984fcc8d811ae637939b83abddaf7"
EXPECTED_BROKER_PID="1760676"
EXPECTED_AGENT_PID="1913117"
EXPECTED_WEB_PID="359766"
EXPECTED_BROKER_UNIT_SHA="fe23347534fd7c3ffba431b5aa2d7640153d93ed9b4c7b0a5b75ea208147b3e7"
EXPECTED_AGENT_UNIT_SHA="00ae0a43e88ea85823d03d7971c9ac3fd56e531fcfddecea20957daaddae70b9"
EXPECTED_WEB_UNIT_SHA="d9d79662bf7a8975d664ed3b6a2bb62c20cc83fde6e98c7e5695ff64e9a2d7ef"
EXPECTED_BROKER_ENTRY_SHA="b6896df0530ef5584306c901bc306ce5c6ddbadc95802181e6a24e6f3d69a7e1"
EXPECTED_AGENT_ENTRY_SHA="9b533fc0850fce23f95943f6d53a64b776d94f2c6a48c2327afdca88e5a9e0e0"
EXPECTED_SERVER_ENTRY_SHA="48507348b12cb54693e3c5a790460afb5b400b9a3400f2751b509700c6e33778"
EXPECTED_OWNER_ACK="I_AUTHORIZE_PHASE128_POST136_ACTIVATE_1D9C27A9C2AC2370BC626807E14C5786DE58671B6547DFC2F5C822EFA45E0A2E"
RELEASE_CONTROLLER_ACK="I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ACTIVATION"

REPO_SLUG="rozkalnsandris/dashboard_RPi5"
PROD_ROOT="/opt/dashboard_RPi5"
CURRENT_RELEASE="$PROD_ROOT/releases/$EXPECTED_CURRENT"
OLD_WEB_RELEASE_PATH="$PROD_ROOT/releases/$OLD_WEB_RELEASE"
TARGET_RELEASE="$PROD_ROOT/releases/$TARGET"
LOCK_PATH="$PROD_ROOT/.dashboard-release-controller.lock"
WORKSPACE="$HOME/.cache/dashboard-rpi5-candidate-prep/${TARGET}-post136"
REPO="$WORKSPACE/repo"
MANIFEST="$WORKSPACE/production-candidate.json"

BROKER_USER="dashboard-rpi5-docker-broker"
BROKER_GROUP="dashboard-rpi5-docker-client"
AGENT_USER="dashboard-rpi5-agent"
WEB_USER="dashboard-rpi5-web"
BROKER_SERVICE="dashboard-rpi5-docker-broker.service"
AGENT_SERVICE="dashboard-rpi5-agent.service"
WEB_SERVICE="dashboard-rpi5-web.service"
BROKER_UNIT="/etc/systemd/system/$BROKER_SERVICE"
AGENT_UNIT="/etc/systemd/system/$AGENT_SERVICE"
WEB_UNIT="/etc/systemd/system/$WEB_SERVICE"
BROKER_SOCKET="/run/dashboard-rpi5-docker-broker/broker.sock"
AGENT_SOCKET="/run/dashboard-rpi5/agent.sock"
TERMINAL_SOCKET="/run/dashboard-rpi5-terminal.sock"

MODE=""
MUTATION_STARTED="NO"
CURRENT_STAGE="argument-parse"

stop() {
  echo "PHASE128_POST136_ACTIVATE_BLOCKED stage=$CURRENT_STAGE reason=$*" >&2
  exit 1
}

on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ "$MUTATION_STARTED" = "YES" ]; then
      echo "PHASE128_POST136_ACTIVATE_EXIT=$rc MUTATION_STARTED=YES AUTHORIZATION_CONSUMED=YES AUTO_RETRY=NO AUTO_ROLLBACK=NO AUTO_CLEANUP=NO BROKER_RESTART=NO SYSTEMD_UNIT_MUTATION=NO IDENTITY_MUTATION=NO PERMISSION_MUTATION=NO CLOUDFLARE_MUTATION=NO TERMINAL_MUTATION=NO QUICK_COMMANDS_MUTATION=NO" >&2
    else
      echo "PHASE128_POST136_ACTIVATE_EXIT=$rc MUTATION_STARTED=NO AUTHORIZATION_CONSUMED=NO PRODUCTION_MUTATION=NO AUTO_RETRY=NO AUTO_CLEANUP=NO" >&2
    fi
  fi
}
trap on_exit EXIT

need() {
  command -v "$1" >/dev/null 2>&1 || stop "missing command: $1"
}

for command_name in curl jq git node sha256sum systemctl readlink stat id getent grep awk sed sudo tail tr; do
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

printf 'PHASE128_POST136_ACTIVATE_START mode=%s target=%s candidate=%s expected_current=%s workspace=%s\n' \
  "$MODE" "$TARGET" "$EXPECTED_CANDIDATE" "$EXPECTED_CURRENT" "$WORKSPACE"

response_status() { printf '%s' "$1" | tail -n 1; }
response_body() { printf '%s' "$1" | sed '$d'; }

unix_response() {
  local user="$1" socket="$2" path="$3" method="${4:-GET}" timeout="${5:-12}"
  sudo -u "$user" curl -sS --max-time "$timeout" --unix-socket "$socket" -X "$method" \
    -H 'Accept: application/json' -w $'\n%{http_code}' "http://localhost$path"
}

proc_has_gid() {
  local pid="$1" gid="$2"
  sudo awk '/^Groups:/ { for (i=2; i<=NF; i++) if ($i == wanted) found=1 } END { exit(found ? 0 : 1) }' \
    wanted="$gid" "/proc/$pid/status"
}

access_probe() {
  curl -sS --max-time 10 -D - -o /dev/null -w $'\nPHASE128_ACCESS_CODE:%{http_code}\n' https://dash.rozkalns.net/
}

wait_for_socket() {
  local socket="$1" index
  for ((index=0; index<50; index+=1)); do
    [ -S "$socket" ] && return 0
    sleep 0.2
  done
  return 1
}

wait_service_active() {
  local service="$1" index
  for ((index=0; index<50; index+=1)); do
    [ "$(systemctl is-active "$service" 2>/dev/null || true)" = active ] && return 0
    sleep 0.2
  done
  return 1
}

wait_loopback_health() {
  local path="$1" expected="$2" index status
  for ((index=0; index<50; index+=1)); do
    status="$(curl -sS --max-time 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:8787$path" 2>/dev/null || true)"
    if [ "$status" = "$expected" ]; then return 0; fi
    if [ -n "$status" ] && [ "$status" != 000 ]; then return 2; fi
    sleep 0.2
  done
  return 1
}

# 1. Fresh exact source and CI binding.
CURRENT_STAGE="preauth-github"
main_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/branches/main")" || stop "GitHub main lookup failed"
[ "$(printf '%s' "$main_json" | jq -er '.commit.sha')" = "$TARGET" ] || stop "main drift"

runs_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/actions/runs?branch=main&event=push&per_page=100")" || stop "Actions lookup failed"
run_json="$(printf '%s' "$runs_json" | jq -ec --arg sha "$TARGET" \
  '[.workflow_runs[] | select(.name == "CI" and .event == "push" and .head_branch == "main" and .head_sha == $sha)] | sort_by(.run_number, (.run_attempt // 1)) | last // empty')" \
  || stop "CI parse failed"
[ -n "$run_json" ] || stop "exact push CI not found"
[ "$(printf '%s' "$run_json" | jq -er '.run_number')" = "$EXPECTED_CI_RUN" ] || stop "unexpected CI run"
[ "$(printf '%s' "$run_json" | jq -er '.id')" = "$EXPECTED_CI_RUN_ID" ] || stop "unexpected CI run id"
[ "$(printf '%s' "$run_json" | jq -er '.status')" = completed ] || stop "CI not completed"
[ "$(printf '%s' "$run_json" | jq -er '.conclusion')" = success ] || stop "CI not successful"

jobs_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/actions/runs/$EXPECTED_CI_RUN_ID/jobs?per_page=100")" || stop "CI jobs lookup failed"
for job_name in "check" "terminal-native (x64)" "terminal-native (arm64)"; do
  count="$(printf '%s' "$jobs_json" | jq -er --arg name "$job_name" \
    '[.jobs[] | select(.name == $name and .status == "completed" and .conclusion == "success")] | length')"
  [ "$count" -eq 1 ] || stop "required CI job not success: $job_name count=$count"
done

# 2. Exact prepared candidate binding.
CURRENT_STAGE="preauth-candidate"
[ -d "$WORKSPACE" ] || stop "candidate workspace missing"
[ -d "$REPO/.git" ] || stop "candidate repository missing"
[ -f "$MANIFEST" ] || stop "candidate manifest missing"
[ "$(git -C "$REPO" rev-parse HEAD)" = "$TARGET" ] || stop "candidate repo source drift"
[ "$(sha256sum "$MANIFEST" | awk '{print $1}')" = "$EXPECTED_MANIFEST_SHA" ] || stop "candidate manifest digest drift"
[ "$(jq -er '.sourceSha' "$MANIFEST")" = "$TARGET" ] || stop "candidate manifest source drift"
[ "$(jq -er '.candidateSha256' "$MANIFEST")" = "$EXPECTED_CANDIDATE" ] || stop "candidate digest drift"
[ "$(jq -er '.fileCount' "$MANIFEST")" = 61 ] || stop "candidate file count drift"
[ "$(jq -er '.totalBytes' "$MANIFEST")" = 6523800 ] || stop "candidate byte count drift"

node "$REPO/tools/production-candidate-manifest.mjs" --root "$REPO" --sha "$TARGET" --verify "$MANIFEST" \
  | grep -q '"status":"PASS"' || stop "candidate manifest verification failed"

[ "$(sha256sum "$REPO/ops/systemd/dashboard-rpi5-docker-broker.service" | awk '{print $1}')" = "$EXPECTED_BROKER_UNIT_SHA" ] || stop "candidate broker unit drift"
[ "$(sha256sum "$REPO/ops/systemd/dashboard-rpi5-agent.service" | awk '{print $1}')" = "$EXPECTED_AGENT_UNIT_SHA" ] || stop "candidate agent unit drift"
[ "$(sha256sum "$REPO/ops/systemd/dashboard-rpi5-web.service" | awk '{print $1}')" = "$EXPECTED_WEB_UNIT_SHA" ] || stop "candidate web unit drift"
[ "$(sha256sum "$REPO/apps/agent/dist/docker-broker-entry.js" | awk '{print $1}')" = "$EXPECTED_BROKER_ENTRY_SHA" ] || stop "candidate broker entry drift"
[ "$(sha256sum "$REPO/apps/agent/dist/index.js" | awk '{print $1}')" = "$EXPECTED_AGENT_ENTRY_SHA" ] || stop "candidate agent entry drift"
[ "$(sha256sum "$REPO/apps/server/dist/index.js" | awk '{print $1}')" = "$EXPECTED_SERVER_ENTRY_SHA" ] || stop "candidate server entry drift"

# 3. Fresh exact partial production baseline.
CURRENT_STAGE="preauth-production"
[ "$(readlink "$PROD_ROOT/current")" = "releases/$EXPECTED_CURRENT" ] || stop "current pointer drift"
[ -d "$CURRENT_RELEASE" ] || stop "A53 release missing"
[ -d "$OLD_WEB_RELEASE_PATH" ] || stop "old web release missing"
[ ! -e "$TARGET_RELEASE" ] || stop "target release already exists before authorization"
[ ! -e "$LOCK_PATH" ] || stop "release-controller lock exists"

for service_name in "$BROKER_SERVICE" "$AGENT_SERVICE" "$WEB_SERVICE"; do
  [ "$(systemctl is-enabled "$service_name")" = enabled ] || stop "$service_name not enabled"
  [ "$(systemctl is-active "$service_name")" = active ] || stop "$service_name not active"
done

broker_pid="$(systemctl show "$BROKER_SERVICE" -p MainPID --value)"
agent_pid="$(systemctl show "$AGENT_SERVICE" -p MainPID --value)"
web_pid="$(systemctl show "$WEB_SERVICE" -p MainPID --value)"
[ "$broker_pid" = "$EXPECTED_BROKER_PID" ] || stop "broker PID drift expected=$EXPECTED_BROKER_PID actual=$broker_pid"
[ "$agent_pid" = "$EXPECTED_AGENT_PID" ] || stop "agent PID drift expected=$EXPECTED_AGENT_PID actual=$agent_pid"
[ "$web_pid" = "$EXPECTED_WEB_PID" ] || stop "web PID drift expected=$EXPECTED_WEB_PID actual=$web_pid"
[ "$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)" = 0 ] || stop "broker NRestarts drift"
[ "$(systemctl show "$AGENT_SERVICE" -p NRestarts --value)" = 0 ] || stop "agent NRestarts drift"
[ "$(systemctl show "$WEB_SERVICE" -p NRestarts --value)" = 0 ] || stop "web NRestarts drift"

[ "$(sudo readlink -f "/proc/$broker_pid/cwd")" = "$CURRENT_RELEASE" ] || stop "broker cwd drift"
[ "$(sudo readlink -f "/proc/$agent_pid/cwd")" = "$CURRENT_RELEASE" ] || stop "agent cwd drift"
[ "$(sudo readlink -f "/proc/$web_pid/cwd")" = "$OLD_WEB_RELEASE_PATH" ] || stop "web cwd drift"

[ "$(sudo sha256sum "$BROKER_UNIT" | awk '{print $1}')" = "$EXPECTED_BROKER_UNIT_SHA" ] || stop "installed broker unit drift"
[ "$(sudo sha256sum "$AGENT_UNIT" | awk '{print $1}')" = "$EXPECTED_AGENT_UNIT_SHA" ] || stop "installed agent unit drift"
[ "$(sudo sha256sum "$WEB_UNIT" | awk '{print $1}')" = "$EXPECTED_WEB_UNIT_SHA" ] || stop "installed web unit drift"
[ "$(sha256sum "$CURRENT_RELEASE/apps/agent/dist/docker-broker-entry.js" | awk '{print $1}')" = "$EXPECTED_BROKER_ENTRY_SHA" ] || stop "running-release broker entry is not byte-identical to target broker entry"

broker_gid="$(getent group "$BROKER_GROUP" | awk -F: '{print $3}')"
docker_gid="$(getent group docker | awk -F: '{print $3}')"
video_gid="$(getent group video | awk -F: '{print $3}')"
[[ "$broker_gid" =~ ^[0-9]+$ ]] || stop "broker group unavailable"
[[ "$docker_gid" =~ ^[0-9]+$ ]] || stop "docker group unavailable"
[[ "$video_gid" =~ ^[0-9]+$ ]] || stop "video group unavailable"

if id -nG "$BROKER_USER" | tr ' ' '\n' | grep -Eq '^(docker|video)$'; then stop "broker persistent privilege group drift"; fi
for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then stop "main agent persistent group boundary violated: $forbidden_group"; fi
done
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -Eq "^(docker|video|$BROKER_GROUP)$"; then stop "web persistent group boundary violated"; fi

proc_has_gid "$broker_pid" "$broker_gid" || stop "broker process missing broker group"
proc_has_gid "$broker_pid" "$docker_gid" || stop "broker process missing Docker supplementary group"
if proc_has_gid "$broker_pid" "$video_gid"; then stop "broker process unexpectedly has video group"; fi
proc_has_gid "$agent_pid" "$broker_gid" || stop "agent process missing runtime broker-client group"
if proc_has_gid "$agent_pid" "$docker_gid"; then stop "agent process unexpectedly has Docker group"; fi
if proc_has_gid "$agent_pid" "$video_gid"; then stop "agent process unexpectedly has video group"; fi

[ "$(sudo stat -Lc '%U:%G:%a:%F' /var/run/docker.sock)" = 'root:docker:660:socket' ] || stop "Docker socket metadata drift"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$BROKER_SOCKET")" = "$BROKER_USER:$BROKER_GROUP:660:socket" ] || stop "broker socket metadata drift"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$AGENT_SOCKET")" = 'dashboard-rpi5-agent:dashboard-rpi5-agent-client:660:socket' ] || stop "agent socket metadata drift"

broker_health="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/health')" || stop "broker health probe failed"
[ "$(response_status "$broker_health")" = 200 ] || stop "broker health not 200"
broker_containers="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/containers')" || stop "broker containers probe failed"
[ "$(response_status "$broker_containers")" = 200 ] || stop "broker containers not 200"

agent_health="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/health')" || stop "agent health probe failed"
[ "$(response_status "$agent_health")" = 200 ] || stop "agent health not 200"
agent_host="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary')" || stop "agent host probe failed"
[ "$(response_status "$agent_host")" = 200 ] || stop "agent host not 200"
agent_docker="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' GET 12 || true)"
[ "$(response_status "$agent_docker")" = 504 ] || stop "A53 agent Docker is no longer exact 504 pre-fix state"
printf '%s' "$(response_body "$agent_docker")" | jq -e '.error == "OPERATION_TIMEOUT"' >/dev/null || stop "A53 Docker timeout body drift"
agent_events="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' GET 5 || true)"
[ "$(response_status "$agent_events")" = 503 ] || stop "Docker events should remain 503 pending #126"
agent_logs="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/logs?sourceId=docker%3Ahomeassistant&range=15m' GET 5 || true)"
[ "$(response_status "$agent_logs")" = 503 ] || stop "Docker logs should remain 503 pending #127"
agent_quick="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' GET 5 || true)"
[ "$(response_status "$agent_quick")" = 404 ] || stop "Quick Commands not 404"
[ ! -S "$TERMINAL_SOCKET" ] || stop "terminal runtime socket exists"

access_before="$(access_probe)" || stop "Access preflight failed"
printf '%s' "$access_before" | grep -q 'PHASE128_ACCESS_CODE:302' || stop "Access preflight not 302"
printf '%s' "$access_before" | grep -qi '^www-authenticate:.*cloudflare-access' || stop "Access marker missing"

# 4. Exact release-controller PLAN immediately before the authorization boundary.
CURRENT_STAGE="preauth-release-plan"
plan="$(cd "$REPO" && sudo /usr/bin/node tools/production-release-controller.mjs \
  --candidate-root "$REPO" --manifest "$MANIFEST" --sha "$TARGET")" || stop "release PLAN failed"
[ "$(printf '%s' "$plan" | jq -er '.status')" = PLAN ] || stop "release plan status mismatch"
[ "$(printf '%s' "$plan" | jq -er '.candidateSha256')" = "$EXPECTED_CANDIDATE" ] || stop "release plan candidate mismatch"
[ "$(printf '%s' "$plan" | jq -er '.observedCurrent')" = "$EXPECTED_CURRENT" ] || stop "release plan current mismatch"
[ "$(printf '%s' "$plan" | jq -er '.targetRelease')" = absent ] || stop "release target should remain absent"
[ "$(printf '%s' "$plan" | jq -c '.operations')" = '["copy_manifest_allowlisted_release","write_verified_manifest_marker","atomic_current_symlink_swap"]' ] || stop "release plan operations mismatch"

printf 'PHASE128_POST136_PREAUTH_PASS target=%s candidate=%s current=%s broker_pid=%s agent_pid=%s web_pid=%s broker=200 agent_host=200 agent_docker=504 events=503 docker_logs=503 quick=404 terminal=absent access=302\n' \
  "$TARGET" "$EXPECTED_CANDIDATE" "$EXPECTED_CURRENT" "$broker_pid" "$agent_pid" "$web_pid"

if [ "$MODE" = preflight ]; then
  echo "PHASE128_POST136_PREFLIGHT_ONLY_STOP PRODUCTION_MUTATION=NO AUTHORIZATION_CONSUMED=NO"
  exit 0
fi

# The owner acknowledgement has already been compared exactly above. From the
# next line onward the authorization is consumed. Any error is evidence + STOP.
MUTATION_STARTED="YES"
CURRENT_STAGE="mutation-release-apply"
echo "PHASE128_POST136_MUTATION_STARTED stage=$CURRENT_STAGE AUTHORIZATION_CONSUMED=YES"
apply="$(cd "$REPO" && sudo /usr/bin/node tools/production-release-controller.mjs \
  --candidate-root "$REPO" --manifest "$MANIFEST" --sha "$TARGET" \
  --expected-current "$EXPECTED_CURRENT" --apply --ack "$RELEASE_CONTROLLER_ACK")" \
  || stop "release apply failed"
[ "$(printf '%s' "$apply" | jq -er '.status')" = APPLIED ] || stop "release apply status mismatch"
[ "$(printf '%s' "$apply" | jq -er '.candidateSha256')" = "$EXPECTED_CANDIDATE" ] || stop "release apply candidate mismatch"
[ "$(printf '%s' "$apply" | jq -er '.previousRelease')" = "$EXPECTED_CURRENT" ] || stop "release apply previous release mismatch"
[ "$(printf '%s' "$apply" | jq -er '.currentRelease')" = "$TARGET" ] || stop "release apply current mismatch"
[ "$(readlink "$PROD_ROOT/current")" = "releases/$TARGET" ] || stop "current pointer did not move to target"
[ -d "$TARGET_RELEASE" ] || stop "target release missing after apply"
node "$TARGET_RELEASE/tools/production-candidate-manifest.mjs" --root "$TARGET_RELEASE" --sha "$TARGET" \
  --verify "$TARGET_RELEASE/.dashboard-production-candidate.json" | grep -q '"status":"PASS"' || stop "installed target manifest verify failed"
[ "$(jq -er '.candidateSha256' "$TARGET_RELEASE/.dashboard-production-candidate.json")" = "$EXPECTED_CANDIDATE" ] || stop "installed target candidate digest mismatch"
[ "$(systemctl show "$BROKER_SERVICE" -p MainPID --value)" = "$broker_pid" ] || stop "broker PID changed during release activation"
[ "$(sudo readlink -f "/proc/$broker_pid/cwd")" = "$CURRENT_RELEASE" ] || stop "broker cwd changed during release activation"

# 5. Restart only the agent; broker is deliberately preserved.
CURRENT_STAGE="mutation-restart-agent"
sudo /usr/bin/systemctl restart "$AGENT_SERVICE" || stop "agent restart command failed"
wait_service_active "$AGENT_SERVICE" || stop "agent did not become active"
wait_for_socket "$AGENT_SOCKET" || stop "agent socket did not become ready"
new_agent_pid="$(systemctl show "$AGENT_SERVICE" -p MainPID --value)"
[[ "$new_agent_pid" =~ ^[1-9][0-9]*$ ]] || stop "invalid new agent PID"
[ "$new_agent_pid" != "$agent_pid" ] || stop "agent PID did not change"
[ "$(sudo readlink -f "/proc/$new_agent_pid/cwd")" = "$TARGET_RELEASE" ] || stop "new agent cwd is not target"
proc_has_gid "$new_agent_pid" "$broker_gid" || stop "new agent missing runtime broker-client group"
if proc_has_gid "$new_agent_pid" "$docker_gid"; then stop "new agent unexpectedly has Docker group"; fi
if proc_has_gid "$new_agent_pid" "$video_gid"; then stop "new agent unexpectedly has video group"; fi
for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then stop "main agent acquired forbidden persistent group: $forbidden_group"; fi
done

new_agent_health="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/health' GET 5)" || stop "new agent health probe failed"
[ "$(response_status "$new_agent_health")" = 200 ] || stop "new agent health not 200"
new_agent_host="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary' GET 5)" || stop "new agent host probe failed"
[ "$(response_status "$new_agent_host")" = 200 ] || stop "new agent host not 200"
new_agent_docker="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' GET 12)" || stop "new agent Docker probe transport failed"
[ "$(response_status "$new_agent_docker")" = 200 ] || stop "source-fixed Docker current-state not 200"
printf '%s' "$(response_body "$new_agent_docker")" | jq -e '(.apiVersion == "1.40") and (.engineVersion | type == "string" and length > 0) and (.containers | type == "array" and length > 0)' >/dev/null \
  || stop "source-fixed Docker payload invalid or empty"
new_events="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' GET 5 || true)"
[ "$(response_status "$new_events")" = 503 ] || stop "Docker events should remain 503 pending #126"
new_logs="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/logs?sourceId=docker%3Ahomeassistant&range=15m' GET 5 || true)"
[ "$(response_status "$new_logs")" = 503 ] || stop "Docker logs should remain 503 pending #127"
new_quick="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' GET 5 || true)"
[ "$(response_status "$new_quick")" = 404 ] || stop "Quick Commands changed after agent cutover"
[ ! -S "$TERMINAL_SOCKET" ] || stop "terminal runtime socket appeared"
[ "$(systemctl show "$BROKER_SERVICE" -p MainPID --value)" = "$broker_pid" ] || stop "broker PID changed during agent cutover"
[ "$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)" = 0 ] || stop "broker restarted during agent cutover"
access_mid="$(access_probe)" || stop "Access probe failed after agent cutover"
printf '%s' "$access_mid" | grep -q 'PHASE128_ACCESS_CODE:302' || stop "Access changed after agent cutover"
printf '%s' "$access_mid" | grep -qi '^www-authenticate:.*cloudflare-access' || stop "Access marker missing after agent cutover"

echo "PHASE128_POST136_AGENT_PASS new_agent_pid=$new_agent_pid host=200 docker=200 events=503 docker_logs=503 quick=404 terminal=absent broker_restart=NO access=302"

# 6. Restart web only after the source-fixed agent has fully passed acceptance.
CURRENT_STAGE="mutation-restart-web"
sudo /usr/bin/systemctl restart "$WEB_SERVICE" || stop "web restart command failed"
wait_service_active "$WEB_SERVICE" || stop "web did not become active"
wait_loopback_health '/api/health' 200 || stop "web health did not become 200"
new_web_pid="$(systemctl show "$WEB_SERVICE" -p MainPID --value)"
[[ "$new_web_pid" =~ ^[1-9][0-9]*$ ]] || stop "invalid new web PID"
[ "$new_web_pid" != "$web_pid" ] || stop "web PID did not change"
[ "$(sudo readlink -f "/proc/$new_web_pid/cwd")" = "$TARGET_RELEASE" ] || stop "new web cwd is not target"
if proc_has_gid "$new_web_pid" "$broker_gid"; then stop "web process unexpectedly has broker-client group"; fi
if proc_has_gid "$new_web_pid" "$docker_gid"; then stop "web process unexpectedly has Docker group"; fi
if proc_has_gid "$new_web_pid" "$video_gid"; then stop "web process unexpectedly has video group"; fi
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -Eq "^(docker|video|$BROKER_GROUP)$"; then stop "web persistent privilege group changed"; fi

web_root="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/)" || stop "web root probe failed"
[ "$web_root" = 200 ] || stop "web root not 200"
web_host="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/current/host)" || stop "web host probe failed"
[ "$web_host" = 200 ] || stop "web host current-state not 200"
web_docker_response="$(curl -sS --max-time 12 -w $'\n%{http_code}' http://127.0.0.1:8787/api/current/docker)" || stop "web Docker probe failed"
[ "$(response_status "$web_docker_response")" = 200 ] || stop "web Docker current-state not 200"
printf '%s' "$(response_body "$web_docker_response")" | jq -e '(.apiVersion == "1.40") and (.engineVersion | type == "string" and length > 0) and (.containers | type == "array" and length > 0)' >/dev/null \
  || stop "web Docker payload invalid or empty"

# 7. Final immutable and trust-boundary proof.
CURRENT_STAGE="postmutation-final-proof"
[ "$(readlink "$PROD_ROOT/current")" = "releases/$TARGET" ] || stop "final current pointer drift"
[ "$(systemctl show "$BROKER_SERVICE" -p MainPID --value)" = "$broker_pid" ] || stop "final broker PID drift"
[ "$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)" = 0 ] || stop "final broker restart count drift"
[ "$(sudo readlink -f "/proc/$broker_pid/cwd")" = "$CURRENT_RELEASE" ] || stop "final broker cwd drift"
[ "$(sudo readlink -f "/proc/$new_agent_pid/cwd")" = "$TARGET_RELEASE" ] || stop "final agent cwd drift"
[ "$(sudo readlink -f "/proc/$new_web_pid/cwd")" = "$TARGET_RELEASE" ] || stop "final web cwd drift"
[ "$(sudo sha256sum "$BROKER_UNIT" | awk '{print $1}')" = "$EXPECTED_BROKER_UNIT_SHA" ] || stop "final broker unit drift"
[ "$(sudo sha256sum "$AGENT_UNIT" | awk '{print $1}')" = "$EXPECTED_AGENT_UNIT_SHA" ] || stop "final agent unit drift"
[ "$(sudo sha256sum "$WEB_UNIT" | awk '{print $1}')" = "$EXPECTED_WEB_UNIT_SHA" ] || stop "final web unit drift"
[ "$(sha256sum "$TARGET_RELEASE/apps/agent/dist/docker-broker-entry.js" | awk '{print $1}')" = "$EXPECTED_BROKER_ENTRY_SHA" ] || stop "final target broker entry drift"
[ "$(sha256sum "$TARGET_RELEASE/apps/agent/dist/index.js" | awk '{print $1}')" = "$EXPECTED_AGENT_ENTRY_SHA" ] || stop "final target agent entry drift"
[ "$(sha256sum "$TARGET_RELEASE/apps/server/dist/index.js" | awk '{print $1}')" = "$EXPECTED_SERVER_ENTRY_SHA" ] || stop "final target server entry drift"
[ "$(sudo stat -Lc '%U:%G:%a:%F' /var/run/docker.sock)" = 'root:docker:660:socket' ] || stop "Docker socket permissions changed"
for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then stop "final main agent persistent group boundary violated: $forbidden_group"; fi
done
if id -nG "$BROKER_USER" | tr ' ' '\n' | grep -Eq '^(docker|video)$'; then stop "final broker persistent group boundary violated"; fi
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -Eq "^(docker|video|$BROKER_GROUP)$"; then stop "final web persistent group boundary violated"; fi
final_events="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' GET 5 || true)"
[ "$(response_status "$final_events")" = 503 ] || stop "Docker events not 503 at final proof"
final_logs="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/logs?sourceId=docker%3Ahomeassistant&range=15m' GET 5 || true)"
[ "$(response_status "$final_logs")" = 503 ] || stop "Docker logs not 503 at final proof"
final_quick="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' GET 5 || true)"
[ "$(response_status "$final_quick")" = 404 ] || stop "Quick Commands not 404 at final proof"
[ ! -S "$TERMINAL_SOCKET" ] || stop "terminal runtime socket present at final proof"
access_after="$(access_probe)" || stop "final Access probe failed"
printf '%s' "$access_after" | grep -q 'PHASE128_ACCESS_CODE:302' || stop "final Access not 302"
printf '%s' "$access_after" | grep -qi '^www-authenticate:.*cloudflare-access' || stop "final Access marker missing"

echo "PHASE128_POST136_ACTIVATION_PASS target=$TARGET candidate=$EXPECTED_CANDIDATE broker_pid=$broker_pid agent_pid=$new_agent_pid web_pid=$new_web_pid host=200 docker=200 events=503 docker_logs=503 quick=404 terminal=absent access=302"
echo "PHASE128_POST136_FINAL production_deploy=YES source_fixed=ACTIVE bounded_docker_broker=PRESERVED broker_restart=NO agent_cutover=COMPLETE web_cutover=COMPLETE systemd_unit_mutation=NO identity_mutation=NO permission_mutation=NO main_agent_docker_group=NO main_agent_video_group=NO cloudflare=UNCHANGED public_launch=YES_ACCESS_PROTECTED"
