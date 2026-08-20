#!/usr/bin/env bash
set -Eeuo pipefail

# #151 post-mutation continuation diagnostic.
# READ-ONLY ONLY. This script intentionally contains no production mutation path.

TARGET="4295c23de5634dcb86b5fe9f57be92416eb9a75b"
EXPECTED_CANDIDATE="f08677aef82d0213422a171b51efd46fa7db57b29385fdd9c5d185f2c7b83eb0"
EXPECTED_MANIFEST_SHA="5e7ed7f70987f93291567b880053a1f46d911f51ce678690fd61bc9f097c60ff"
EXPECTED_BROKER_ENTRY_SHA="a9fdbf13c704b0c9bc1d03ec5698198630a967d282644fb3440dfab2ff8de05d"
PREVIOUS_RELEASE="15f44e3a6fdda8f2e97b26501a283f6bba915e86"
EXPECTED_AGENT_PID="3482974"
EXPECTED_WEB_PID="3378022"
REVIEWED_MAIN="c5c6d9591fe92da5f9aa5913a963741fadb9fbcf"

REPO_SLUG="rozkalnsandris/dashboard_RPi5"
PROD_ROOT="/opt/dashboard_RPi5"
TARGET_RELEASE="$PROD_ROOT/releases/$TARGET"
CURRENT_LINK="$PROD_ROOT/current"
MANIFEST_MARKER="$TARGET_RELEASE/.dashboard-production-candidate.json"
BROKER_ENTRY="$TARGET_RELEASE/apps/agent/dist/docker-broker-entry.js"
BROKER_SERVICE="dashboard-rpi5-docker-broker.service"
AGENT_SERVICE="dashboard-rpi5-agent.service"
WEB_SERVICE="dashboard-rpi5-web.service"
BROKER_USER="dashboard-rpi5-docker-broker"
BROKER_GROUP="dashboard-rpi5-docker-client"
WEB_USER="dashboard-rpi5-web"
BROKER_RUNTIME_DIR="/run/dashboard-rpi5-docker-broker"
BROKER_SOCKET="$BROKER_RUNTIME_DIR/broker.sock"
AGENT_SOCKET="/run/dashboard-rpi5/agent.sock"
TERMINAL_SOCKET="/run/dashboard-rpi5-terminal.sock"
BROKER_UNIT="/etc/systemd/system/$BROKER_SERVICE"
AGENT_UNIT="/etc/systemd/system/$AGENT_SERVICE"
WEB_UNIT="/etc/systemd/system/$WEB_SERVICE"
BROKER_UNIT_SOURCE="$TARGET_RELEASE/ops/systemd/dashboard-rpi5-docker-broker.service"
AGENT_UNIT_SOURCE="$TARGET_RELEASE/ops/systemd/dashboard-rpi5-agent.service"
WEB_UNIT_SOURCE="$TARGET_RELEASE/ops/systemd/dashboard-rpi5-web.service"
NODE_BIN="/usr/bin/node"

CURRENT_STAGE="argument-parse"

stop() {
  printf 'ISSUE151_POSTMUTATION_READONLY_BLOCKED stage=%s reason=%s\n' "$CURRENT_STAGE" "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || stop "missing command: $1"
}

for command_name in curl jq sha256sum systemctl readlink stat id grep awk sed sudo tail sleep find journalctl; do
  need "$command_name"
done

[ "$(id -u)" -ne 0 ] || stop "run as normal operator, not root"
[ -x "$NODE_BIN" ] || stop "systemd Node binary missing or non-executable: $NODE_BIN"
[ "$#" -eq 1 ] && [ "$1" = "--read-only" ] || stop "usage: $0 --read-only"

response_status() { printf '%s' "$1" | tail -n 1; }

unix_status_only() {
  local user="$1" socket="$2" path="$3" timeout="${4:-5}"
  sudo -u "$user" curl -sS --max-time "$timeout" \
    --unix-socket "$socket" -o /dev/null -w '%{http_code}' \
    "http://localhost$path"
}

privileged_socket_exists() {
  sudo test -S "$1"
}

access_probe() {
  curl -sS --max-time 10 -D - -o /dev/null \
    -w $'\nISSUE151_ACCESS_CODE:%{http_code}\n' https://dash.rozkalns.net/
}

wait_privileged_socket() {
  local service="$1" socket="$2" expected_pid="$3" index active pid
  for ((index=0; index<50; index+=1)); do
    if privileged_socket_exists "$socket"; then return 0; fi
    active="$(systemctl is-active "$service" 2>/dev/null || true)"
    pid="$(systemctl show "$service" -p MainPID --value)"
    [ "$active" = active ] || return 2
    [ "$pid" = "$expected_pid" ] || return 3
    sleep 0.2
  done
  return 1
}

verify_target_manifest() {
  sudo /usr/bin/node "$TARGET_RELEASE/tools/production-candidate-manifest.mjs" \
    --root "$TARGET_RELEASE" --sha "$TARGET" --verify "$MANIFEST_MARKER" \
    | grep -q '"status":"PASS"'
}

metadata_pass() {
  local bad_owner bad_group bad_dir bad_file marker_mode
  bad_owner="$(sudo find "$TARGET_RELEASE" -xdev \( -type d -o -type f \) ! -user root -print -quit)"
  [ -z "$bad_owner" ] || return 1
  bad_group="$(sudo find "$TARGET_RELEASE" -xdev \( -type d -o -type f \) ! -group root -print -quit)"
  [ -z "$bad_group" ] || return 1
  bad_dir="$(sudo find "$TARGET_RELEASE" -xdev -type d ! -perm 0755 -print -quit)"
  [ -z "$bad_dir" ] || return 1
  bad_file="$(sudo find "$TARGET_RELEASE" -xdev -type f ! -path "$MANIFEST_MARKER" ! -perm 0644 -print -quit)"
  [ -z "$bad_file" ] || return 1
  marker_mode="$(sudo stat -Lc '%a' "$MANIFEST_MARKER")"
  [ "$marker_mode" = 600 ]
}

printf '%s\n' \
  'ISSUE151_POSTMUTATION_READONLY_START' \
  'PRODUCTION_MUTATION=NO' \
  'AUTHORIZATION_CONSUMED=YES' \
  'AUTO_RETRY=NO' \
  'AUTO_ROLLBACK=NO' \
  'AUTO_CLEANUP=NO'

###############################################################################
# 1. Source and installed-target binding after the consumed recovery mutation.
###############################################################################

CURRENT_STAGE="source-target"
main_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/branches/main")" || stop "GitHub main lookup failed"
current_main="$(printf '%s' "$main_json" | jq -er '.commit.sha')"

ancestry_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/compare/$REVIEWED_MAIN...$current_main")" || stop "GitHub ancestry lookup failed"
printf '%s' "$ancestry_json" | jq -e --arg reviewed "$REVIEWED_MAIN" '
  (.base_commit.sha == $reviewed)
  and (.merge_base_commit.sha == $reviewed)
  and ((.status == "identical") or (.status == "ahead"))
  and (.behind_by == 0)
' >/dev/null || stop "current main is not a safe descendant of reviewed recovery anchor"

[ "$(readlink "$CURRENT_LINK")" = "releases/$TARGET" ] || stop "current pointer drift"
[ -d "$TARGET_RELEASE" ] || stop "target release missing"
sudo test -f "$MANIFEST_MARKER" || stop "manifest marker missing"
[ "$(sudo sha256sum "$MANIFEST_MARKER" | awk '{print $1}')" = "$EXPECTED_MANIFEST_SHA" ] || stop "manifest digest drift"
[ "$(sudo jq -er '.candidateSha256' "$MANIFEST_MARKER")" = "$EXPECTED_CANDIDATE" ] || stop "candidate digest drift"
[ "$(sudo jq -er '.sourceSha' "$MANIFEST_MARKER")" = "$TARGET" ] || stop "source SHA drift"
verify_target_manifest || stop "target manifest verification failed"
[ "$(sudo sha256sum "$BROKER_ENTRY" | awk '{print $1}')" = "$EXPECTED_BROKER_ENTRY_SHA" ] || stop "broker entry digest drift"
metadata_pass || stop "normalized target metadata drift"

for unit_pair in \
  "$BROKER_UNIT|$BROKER_UNIT_SOURCE" \
  "$AGENT_UNIT|$AGENT_UNIT_SOURCE" \
  "$WEB_UNIT|$WEB_UNIT_SOURCE"; do
  installed_unit="${unit_pair%%|*}"
  source_unit="${unit_pair#*|}"
  sudo test -f "$installed_unit" || stop "installed unit missing: $installed_unit"
  sudo test -f "$source_unit" || stop "target unit source missing: $source_unit"
  installed_sha="$(sudo sha256sum "$installed_unit" | awk '{print $1}')"
  source_sha="$(sudo sha256sum "$source_unit" | awk '{print $1}')"
  [ "$installed_sha" = "$source_sha" ] || stop "installed unit drift: $installed_unit"
done

node_version="$("$NODE_BIN" -p 'process.versions.node')"
node_major="${node_version%%.*}"
node_rest="${node_version#*.}"
node_minor="${node_rest%%.*}"
node_import_meta_main="NO"
if [ "$node_major" -gt 24 ] || { [ "$node_major" -eq 24 ] && [ "$node_minor" -ge 2 ]; }; then
  node_import_meta_main="YES"
fi

printf 'ISSUE151_POSTMUTATION_TARGET_PASS current_main=%s target=%s metadata=root:root/0755-files0644-marker0600 node=%s import_meta_main_supported=%s\n' \
  "$current_main" "$TARGET" "$node_version" "$node_import_meta_main"

###############################################################################
# 2. Broker process/runtime-directory/socket evidence.
###############################################################################

CURRENT_STAGE="broker-runtime"
[ "$(systemctl is-active docker.service)" = active ] || stop "Docker service not active"

broker_active="$(systemctl is-active "$BROKER_SERVICE" 2>/dev/null || true)"
broker_substate="$(systemctl show "$BROKER_SERVICE" -p SubState --value)"
broker_result="$(systemctl show "$BROKER_SERVICE" -p Result --value)"
broker_exec_status="$(systemctl show "$BROKER_SERVICE" -p ExecMainStatus --value)"
broker_restart_policy="$(systemctl show "$BROKER_SERVICE" -p Restart --value)"
broker_pid_before="$(systemctl show "$BROKER_SERVICE" -p MainPID --value)"
broker_nrestarts_before="$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)"

sleep 1

broker_pid_after="$(systemctl show "$BROKER_SERVICE" -p MainPID --value)"
broker_nrestarts_after="$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)"
restart_stable="NO"
[ "$broker_pid_before" = "$broker_pid_after" ] && [ "$broker_nrestarts_before" = "$broker_nrestarts_after" ] && restart_stable="YES"

runtime_dir_state="absent"
runtime_dir_meta="NA"
if sudo test -d "$BROKER_RUNTIME_DIR"; then
  runtime_dir_state="present"
  runtime_dir_meta="$(sudo stat -Lc '%U:%G:%a:%F' "$BROKER_RUNTIME_DIR")"
fi

broker_cwd="NA"
if [[ "$broker_pid_after" =~ ^[1-9][0-9]*$ ]] && sudo test -d "/proc/$broker_pid_after"; then
  broker_cwd="$(sudo readlink -f "/proc/$broker_pid_after/cwd" || true)"
fi

socket_wait_rc=1
if [ "$broker_active" = active ] && [[ "$broker_pid_after" =~ ^[1-9][0-9]*$ ]]; then
  set +e
  wait_privileged_socket "$BROKER_SERVICE" "$BROKER_SOCKET" "$broker_pid_after"
  socket_wait_rc=$?
  set -e
fi

socket_state="absent"
socket_meta="NA"
health_status="000"
docker_status="000"
ha_logs_status="000"
prom_logs_status="000"
forbidden_range_status="000"
events_path_status="000"

if privileged_socket_exists "$BROKER_SOCKET"; then
  socket_state="present"
  socket_meta="$(sudo stat -Lc '%U:%G:%a:%F' "$BROKER_SOCKET")"
  health_status="$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/health' 5 2>/dev/null || true)"
  docker_status="$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/containers' 12 2>/dev/null || true)"
  ha_logs_status="$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/logs/homeassistant/15m' 12 2>/dev/null || true)"
  prom_logs_status="$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/logs/prometheus/24h' 12 2>/dev/null || true)"
  forbidden_range_status="$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/logs/homeassistant/7d' 5 2>/dev/null || true)"
  events_path_status="$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/events' 5 2>/dev/null || true)"
fi

broker_classification="BROKER_NOT_READY"
if [ "$broker_active" = active ] \
  && [ "$restart_stable" = YES ] \
  && [ "$broker_cwd" = "$TARGET_RELEASE" ] \
  && [ "$runtime_dir_meta" = "$BROKER_USER:$BROKER_GROUP:750:directory" ] \
  && [ "$socket_meta" = "$BROKER_USER:$BROKER_GROUP:660:socket" ] \
  && [ "$health_status" = 200 ] \
  && [ "$docker_status" = 200 ] \
  && [ "$ha_logs_status" = 200 ] \
  && [ "$prom_logs_status" = 200 ] \
  && [ "$forbidden_range_status" = 404 ] \
  && [ "$events_path_status" = 404 ]; then
  broker_classification="BROKER_HEALTHY_POST_START"
elif [ "$broker_active" = active ] && [ "$socket_state" = absent ]; then
  broker_classification="BROKER_ACTIVE_SOCKET_UNPROVEN"
elif [ "$broker_active" != active ]; then
  broker_classification="BROKER_NOT_ACTIVE"
fi

printf 'ISSUE151_POSTMUTATION_BROKER broker_active=%s substate=%s result=%s exec_status=%s restart=%s pid=%s nrestarts=%s restart_stable=%s cwd=%s runtime_dir=%s runtime_meta=%s socket=%s socket_meta=%s socket_wait_rc=%s health=%s docker=%s ha_logs=%s prometheus_logs=%s forbidden_range=%s events_path=%s classification=%s\n' \
  "$broker_active" "$broker_substate" "$broker_result" "$broker_exec_status" "$broker_restart_policy" \
  "$broker_pid_after" "$broker_nrestarts_after" "$restart_stable" "$broker_cwd" "$runtime_dir_state" "$runtime_dir_meta" \
  "$socket_state" "$socket_meta" "$socket_wait_rc" "$health_status" "$docker_status" "$ha_logs_status" \
  "$prom_logs_status" "$forbidden_range_status" "$events_path_status" "$broker_classification"

###############################################################################
# 3. Prove agent/web were not cut over by the failed recovery.
###############################################################################

CURRENT_STAGE="agent-web-boundary"
agent_pid="$(systemctl show "$AGENT_SERVICE" -p MainPID --value)"
web_pid="$(systemctl show "$WEB_SERVICE" -p MainPID --value)"
[ "$(systemctl is-active "$AGENT_SERVICE")" = active ] || stop "agent not active"
[ "$(systemctl is-active "$WEB_SERVICE")" = active ] || stop "web not active"
[ "$agent_pid" = "$EXPECTED_AGENT_PID" ] || stop "agent PID drift"
[ "$web_pid" = "$EXPECTED_WEB_PID" ] || stop "web PID drift"
agent_cwd="$(sudo readlink -f "/proc/$agent_pid/cwd")"
web_cwd="$(sudo readlink -f "/proc/$web_pid/cwd")"
[ "$agent_cwd" = "$PROD_ROOT/releases/$PREVIOUS_RELEASE" ] || stop "agent cwd drift"
[ "$web_cwd" = "$PROD_ROOT/releases/$PREVIOUS_RELEASE" ] || stop "web cwd drift"

host_status="$(unix_status_only "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary' 5 2>/dev/null || true)"
agent_docker_status="$(unix_status_only "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' 12 2>/dev/null || true)"
agent_logs_status="$(unix_status_only "$WEB_USER" "$AGENT_SOCKET" '/v1/logs?sourceId=docker%3Ahomeassistant&range=15m' 12 2>/dev/null || true)"
agent_events_status="$(unix_status_only "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' 5 2>/dev/null || true)"
quick_status="$(unix_status_only "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' 5 2>/dev/null || true)"
terminal_state="absent"
privileged_socket_exists "$TERMINAL_SOCKET" && terminal_state="present"

access_evidence="$(access_probe 2>/dev/null || true)"
access_status="$(printf '%s' "$access_evidence" | sed -n 's/^ISSUE151_ACCESS_CODE://p' | tail -n 1)"
access_marker="NO"
printf '%s' "$access_evidence" | grep -qi '^www-authenticate:.*cloudflare-access' && access_marker="YES"

printf 'ISSUE151_POSTMUTATION_AGENT_WEB agent_pid=%s agent_cwd=%s web_pid=%s web_cwd=%s host=%s docker=%s logs=%s events=%s quick=%s terminal=%s access=%s access_marker=%s\n' \
  "$agent_pid" "$agent_cwd" "$web_pid" "$web_cwd" "$host_status" "$agent_docker_status" "$agent_logs_status" "$agent_events_status" "$quick_status" "$terminal_state" "$access_status" "$access_marker"

###############################################################################
# 4. Bounded journal evidence. journalctl is read-only.
###############################################################################

CURRENT_STAGE="journal-evidence"
printf '%s\n' '=== ISSUE151_POSTMUTATION_BROKER_JOURNAL_BEGIN ==='
sudo journalctl -u "$BROKER_SERVICE" --no-pager -n 80 || true
printf '%s\n' '=== ISSUE151_POSTMUTATION_BROKER_JOURNAL_END ==='

printf 'ISSUE151_POSTMUTATION_READONLY_COMPLETE classification=%s PRODUCTION_MUTATION=NO AUTHORIZATION_CONSUMED=YES NEXT_GATE=SOURCE_REVIEW_THEN_NEW_EXPLICIT_OWNER_GATE\n' \
  "$broker_classification"
