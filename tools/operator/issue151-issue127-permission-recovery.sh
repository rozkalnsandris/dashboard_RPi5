#!/usr/bin/env bash
set -Eeuo pipefail

TARGET="4295c23de5634dcb86b5fe9f57be92416eb9a75b"
EXPECTED_TREE="df24c7e8e2047176c43f24989e4910a30fa1bc02"
EXPECTED_CANDIDATE="f08677aef82d0213422a171b51efd46fa7db57b29385fdd9c5d185f2c7b83eb0"
EXPECTED_MANIFEST_SHA="5e7ed7f70987f93291567b880053a1f46d911f51ce678690fd61bc9f097c60ff"
EXPECTED_BROKER_ENTRY_SHA="a9fdbf13c704b0c9bc1d03ec5698198630a967d282644fb3440dfab2ff8de05d"
EXPECTED_AGENT_ENTRY_SHA="b44522f3998e723e7cea1a6ab136e0f57933f05925027365fc2cbda0ef47f56d"
EXPECTED_SERVER_DIST_SHA="bf5af5080c552f460123a39c23da66053319052297401740b9037fda84af8c6e"
PREVIOUS_RELEASE="15f44e3a6fdda8f2e97b26501a283f6bba915e86"
EXPECTED_AGENT_PID="3482974"
EXPECTED_WEB_PID="3378022"
EXPECTED_OWNER_ACK="I_AUTHORIZE_ISSUE151_ISSUE127_PERMISSION_RECOVERY_4295C23DE5634DCB86B5FE9F57BE92416EB9A75B"

REPO_SLUG="rozkalnsandris/dashboard_RPi5"
PROD_ROOT="/opt/dashboard_RPi5"
TARGET_RELEASE="$PROD_ROOT/releases/$TARGET"
CURRENT_LINK="$PROD_ROOT/current"
MANIFEST_MARKER="$TARGET_RELEASE/.dashboard-production-candidate.json"
BROKER_ENTRY="$TARGET_RELEASE/apps/agent/dist/docker-broker-entry.js"
AGENT_ENTRY="$TARGET_RELEASE/apps/agent/dist/index.js"
SERVER_DIST="$TARGET_RELEASE/apps/server/dist"
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
BROKER_UNIT="/etc/systemd/system/$BROKER_SERVICE"
AGENT_UNIT="/etc/systemd/system/$AGENT_SERVICE"
WEB_UNIT="/etc/systemd/system/$WEB_SERVICE"
QUICK_DROPIN="/etc/systemd/system/dashboard-rpi5-agent.service.d/10-quick-commands.conf"

MODE=""
MUTATION_STARTED="NO"
CURRENT_STAGE="argument-parse"

stop() {
  echo "ISSUE151_RECOVERY_BLOCKED stage=$CURRENT_STAGE reason=$*" >&2
  exit 1
}

on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ "$MUTATION_STARTED" = "YES" ]; then
      echo "ISSUE151_RECOVERY_EXIT=$rc MUTATION_STARTED=YES AUTHORIZATION_CONSUMED=YES AUTO_RETRY=NO AUTO_ROLLBACK=NO AUTO_CLEANUP=NO ALTERNATE_PERMISSION_CHANGE=NO SYSTEMD_UNIT_MUTATION=NO IDENTITY_GROUP_MUTATION=NO CLOUDFLARE_MUTATION=NO TERMINAL_MUTATION=NO EVENTS_MUTATION=NO ACTIONS_MUTATION=NO" >&2
    else
      echo "ISSUE151_RECOVERY_EXIT=$rc MUTATION_STARTED=NO AUTHORIZATION_CONSUMED=NO PRODUCTION_MUTATION=NO AUTO_RETRY=NO AUTO_CLEANUP=NO" >&2
    fi
  fi
}
trap on_exit EXIT

need() {
  command -v "$1" >/dev/null 2>&1 || stop "missing command: $1"
}

for command_name in curl jq node sha256sum systemctl readlink stat id getent grep awk sed sudo tail tr sleep find sort xargs cut; do
  need "$command_name"
done

[ "$(id -u)" -ne 0 ] || stop "run as normal operator, not root"
[ "$(node -p 'process.versions.node.split(".")[0]')" = 24 ] || stop "Node major is not 24"

if [ "$#" -eq 1 ] && [ "$1" = "--preflight-only" ]; then
  MODE="preflight"
elif [ "$#" -eq 2 ] && [ "$1" = "--owner-ack" ]; then
  MODE="recover"
  [ "$2" = "$EXPECTED_OWNER_ACK" ] || stop "owner acknowledgement mismatch"
else
  stop "usage: $0 --preflight-only | --owner-ack <exact-ack>"
fi

printf 'ISSUE151_RECOVERY_START mode=%s target=%s candidate=%s previous=%s\n' \
  "$MODE" "$TARGET" "$EXPECTED_CANDIDATE" "$PREVIOUS_RELEASE"

response_status() { printf '%s' "$1" | tail -n 1; }
response_body() { printf '%s' "$1" | sed '$d'; }

unix_response() {
  local user="$1" socket="$2" path="$3" timeout="${4:-12}"
  sudo -u "$user" curl -sS --max-time "$timeout" \
    --unix-socket "$socket" -H 'Accept: application/json' \
    -w $'\n%{http_code}' "http://localhost$path"
}

unix_status_only() {
  local user="$1" socket="$2" path="$3" timeout="${4:-12}"
  sudo -u "$user" curl -sS --max-time "$timeout" \
    --unix-socket "$socket" -o /dev/null -w '%{http_code}' \
    "http://localhost$path"
}

loopback_response() {
  local path="$1" timeout="${2:-12}"
  curl -sS --max-time "$timeout" -H 'Accept: application/json' \
    -w $'\n%{http_code}' "http://127.0.0.1:8787$path"
}

access_probe() {
  curl -sS --max-time 10 -D - -o /dev/null \
    -w $'\nISSUE151_ACCESS_CODE:%{http_code}\n' https://dash.rozkalns.net/
}

proc_has_gid() {
  local pid="$1" gid="$2"
  sudo awk '/^Groups:/ { for (i=2; i<=NF; i++) if ($i == wanted) found=1 } END { exit(found ? 0 : 1) }' \
    wanted="$gid" "/proc/$pid/status"
}

wait_service_state() {
  local service="$1" expected="$2" index state
  for ((index=0; index<50; index+=1)); do
    state="$(systemctl is-active "$service" 2>/dev/null || true)"
    [ "$state" = "$expected" ] && return 0
    sleep 0.2
  done
  return 1
}

wait_unix_status_only() {
  local user="$1" socket="$2" path="$3" expected="$4" timeout="$5" index status
  for ((index=0; index<50; index+=1)); do
    status="$(unix_status_only "$user" "$socket" "$path" "$timeout" 2>/dev/null || true)"
    [ "$status" = "$expected" ] && return 0
    if [[ "$status" =~ ^[0-9]{3}$ ]] && [ "$status" != 000 ]; then return 2; fi
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
  sudo jq -er --arg path "$1" '.files[] | select(.path == $path) | .sha256' "$MANIFEST_MARKER"
}

verify_target_manifest() {
  sudo /usr/bin/node "$TARGET_RELEASE/tools/production-candidate-manifest.mjs" \
    --root "$TARGET_RELEASE" --sha "$TARGET" --verify "$MANIFEST_MARKER" \
    | grep -q '"status":"PASS"'
}

assert_target_metadata_normalized() {
  local bad_owner bad_dir bad_file marker_mode
  bad_owner="$(sudo find "$TARGET_RELEASE" -xdev \( -type d -o -type f \) ! -user root -print -quit)"
  [ -z "$bad_owner" ] || stop "target release contains non-root owner: $bad_owner"
  bad_owner="$(sudo find "$TARGET_RELEASE" -xdev \( -type d -o -type f \) ! -group root -print -quit)"
  [ -z "$bad_owner" ] || stop "target release contains non-root group: $bad_owner"
  bad_dir="$(sudo find "$TARGET_RELEASE" -xdev -type d ! -perm 0755 -print -quit)"
  [ -z "$bad_dir" ] || stop "target release directory mode drift: $bad_dir"
  bad_file="$(sudo find "$TARGET_RELEASE" -xdev -type f ! -path "$MANIFEST_MARKER" ! -perm 0644 -print -quit)"
  [ -z "$bad_file" ] || stop "target release file mode drift: $bad_file"
  marker_mode="$(sudo stat -Lc '%a' "$MANIFEST_MARKER")"
  [ "$marker_mode" = 600 ] || stop "manifest marker mode drift: $marker_mode"
}

###############################################################################
# 1. Read-only source and installed-target binding.
###############################################################################

CURRENT_STAGE="preflight-source-target"
main_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/branches/main")" || stop "GitHub main lookup failed"
[ "$(printf '%s' "$main_json" | jq -er '.commit.sha')" = "$TARGET" ] || stop "main SHA drift"
[ "$(printf '%s' "$main_json" | jq -er '.commit.commit.tree.sha')" = "$EXPECTED_TREE" ] || stop "main tree drift"

[ "$(readlink "$CURRENT_LINK")" = "releases/$TARGET" ] || stop "current pointer is not exact target"
[ -d "$TARGET_RELEASE" ] || stop "target release missing"
sudo test -f "$MANIFEST_MARKER" || stop "installed manifest marker missing"
[ "$(sudo sha256sum "$MANIFEST_MARKER" | awk '{print $1}')" = "$EXPECTED_MANIFEST_SHA" ] || stop "installed manifest file digest drift"
[ "$(sudo jq -er '.candidateSha256' "$MANIFEST_MARKER")" = "$EXPECTED_CANDIDATE" ] || stop "installed candidate digest drift"
[ "$(sudo jq -er '.sourceSha' "$MANIFEST_MARKER")" = "$TARGET" ] || stop "installed source SHA drift"
verify_target_manifest || stop "installed target manifest verification failed"
[ "$(sudo sha256sum "$BROKER_ENTRY" | awk '{print $1}')" = "$EXPECTED_BROKER_ENTRY_SHA" ] || stop "broker entry digest drift"
[ "$(manifest_sha_for 'apps/agent/dist/index.js')" = "$EXPECTED_AGENT_ENTRY_SHA" ] || stop "agent entry manifest digest drift"
server_dist_sha="$(sudo find "$SERVER_DIST" -type f -print0 | sort -z | sudo xargs -0 sha256sum | sha256sum | awk '{print $1}')"
[ "$server_dist_sha" = "$EXPECTED_SERVER_DIST_SHA" ] || stop "server dist aggregate drift"

release_mode="$(sudo stat -Lc '%a' "$TARGET_RELEASE")"
broker_entry_mode="$(sudo stat -Lc '%a' "$BROKER_ENTRY")"
[ "$release_mode" = 700 ] || stop "expected incident release root mode 700, observed $release_mode"
[ "$broker_entry_mode" = 600 ] || stop "expected incident broker entry mode 600, observed $broker_entry_mode"

###############################################################################
# 2. Read-only live incident boundary.
###############################################################################

CURRENT_STAGE="preflight-live-incident"
[ "$(systemctl is-active docker.service)" = active ] || stop "Docker service not active"
[ "$(systemctl is-enabled "$BROKER_SERVICE")" = enabled ] || stop "broker not enabled"
[ "$(systemctl show "$BROKER_SERVICE" -p Restart --value)" = on-failure ] || stop "broker Restart policy drift"
[ "$(systemctl show "$BROKER_SERVICE" -p Result --value)" = exit-code ] || stop "broker failure Result drift"
[ "$(systemctl show "$BROKER_SERVICE" -p ExecMainStatus --value)" = 200 ] || stop "broker failure is not CHDIR status 200"
broker_nrestarts="$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)"
[[ "$broker_nrestarts" =~ ^[0-9]+$ ]] && [ "$broker_nrestarts" -ge 1 ] || stop "broker auto-restart evidence missing"
[ ! -S "$BROKER_SOCKET" ] || stop "broker socket unexpectedly exists during CHDIR failure"

[ "$(systemctl is-active "$AGENT_SERVICE")" = active ] || stop "agent not active"
[ "$(systemctl is-active "$WEB_SERVICE")" = active ] || stop "web not active"
agent_pid="$(systemctl show "$AGENT_SERVICE" -p MainPID --value)"
web_pid="$(systemctl show "$WEB_SERVICE" -p MainPID --value)"
[ "$agent_pid" = "$EXPECTED_AGENT_PID" ] || stop "agent PID drift"
[ "$web_pid" = "$EXPECTED_WEB_PID" ] || stop "web PID drift"
[ "$(sudo readlink -f "/proc/$agent_pid/cwd")" = "$PROD_ROOT/releases/$PREVIOUS_RELEASE" ] || stop "agent cwd drift"
[ "$(sudo readlink -f "/proc/$web_pid/cwd")" = "$PROD_ROOT/releases/$PREVIOUS_RELEASE" ] || stop "web cwd drift"

host_pre="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary' 5)" || stop "host preflight failed"
[ "$(response_status "$host_pre")" = 200 ] || stop "host preflight not 200"
docker_pre="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' 5 || true)"
[ "$(response_status "$docker_pre")" = 503 ] || stop "Docker current-state should be 503 while broker is down"
logs_pre="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/logs?sourceId=docker%3Ahomeassistant&range=15m' 5 || true)"
[ "$(response_status "$logs_pre")" = 503 ] || stop "Docker logs should be 503 while broker is down"
events_pre="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' 5 || true)"
[ "$(response_status "$events_pre")" = 503 ] || stop "Docker events should remain 503 pending #126"
quick_pre="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' 5)" || stop "Quick Commands preflight failed"
[ "$(response_status "$quick_pre")" = 200 ] || stop "Quick Commands preflight not 200"
validate_quick_catalog "$(response_body "$quick_pre")" || stop "Quick Commands catalog drift"
[ ! -S "$TERMINAL_SOCKET" ] || stop "terminal/PTTY socket unexpectedly present"
access_pre="$(access_probe)" || stop "Cloudflare Access preflight failed"
printf '%s' "$access_pre" | grep -q 'ISSUE151_ACCESS_CODE:302' || stop "Cloudflare Access preflight not 302"
printf '%s' "$access_pre" | grep -qi '^www-authenticate:.*cloudflare-access' || stop "Cloudflare Access marker missing"

broker_unit_sha="$(sudo sha256sum "$BROKER_UNIT" | awk '{print $1}')"
agent_unit_sha="$(sudo sha256sum "$AGENT_UNIT" | awk '{print $1}')"
web_unit_sha="$(sudo sha256sum "$WEB_UNIT" | awk '{print $1}')"
quick_dropin_sha="$(sudo sha256sum "$QUICK_DROPIN" | awk '{print $1}')"
docker_gid="$(getent group docker | cut -d: -f3)"
broker_gid="$(getent group "$BROKER_GROUP" | cut -d: -f3)"
video_gid="$(getent group video | cut -d: -f3)"
[[ "$docker_gid" =~ ^[0-9]+$ && "$broker_gid" =~ ^[0-9]+$ && "$video_gid" =~ ^[0-9]+$ ]] || stop "required group lookup failed"
for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then stop "main agent persistent group boundary violated: $forbidden_group"; fi
done

printf 'ISSUE151_RECOVERY_PREAUTH_PASS target=%s candidate=%s current=%s release_mode=%s broker_entry_mode=%s broker_result=exit-code broker_exec_status=200 broker_nrestarts=%s agent_pid=%s web_pid=%s host=200 docker=503 logs=503 events=503 quick=200 terminal=absent access=302\n' \
  "$TARGET" "$EXPECTED_CANDIDATE" "$TARGET" "$release_mode" "$broker_entry_mode" "$broker_nrestarts" "$agent_pid" "$web_pid"

if [ "$MODE" = preflight ]; then
  echo "ISSUE151_RECOVERY_PREFLIGHT_ONLY_STOP PRODUCTION_MUTATION=NO AUTHORIZATION_CONSUMED=NO BROKER_STOP=NO OWNERSHIP_MUTATION=NO PERMISSION_MUTATION=NO BROKER_START=NO AGENT_RESTART=NO WEB_RESTART=NO SYSTEMD_UNIT_MUTATION=NO IDENTITY_GROUP_MUTATION=NO CLOUDFLARE_MUTATION=NO TERMINAL_MUTATION=NO EVENTS_MUTATION=NO ACTIONS_MUTATION=NO"
  exit 0
fi

###############################################################################
# 3. Mutation boundary: quiesce the failing broker loop before metadata repair.
###############################################################################

MUTATION_STARTED="YES"
CURRENT_STAGE="mutation-stop-broker-loop"
echo "ISSUE151_RECOVERY_MUTATION_STARTED stage=$CURRENT_STAGE AUTHORIZATION_CONSUMED=YES"
sudo /usr/bin/systemctl stop "$BROKER_SERVICE" || stop "broker stop failed"
wait_service_state "$BROKER_SERVICE" inactive || stop "broker did not become inactive"
[ "$(systemctl show "$BROKER_SERVICE" -p MainPID --value)" = 0 ] || stop "broker PID remains after stop"
[ ! -S "$BROKER_SOCKET" ] || stop "broker socket exists after stop"
broker_nrestarts_stopped="$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)"

###############################################################################
# 4. Normalize only the exact already-verified immutable target release metadata.
###############################################################################

CURRENT_STAGE="mutation-normalize-target-metadata"
sudo /usr/bin/find "$TARGET_RELEASE" -xdev -type d -exec /usr/bin/chown root:root -- {} +
sudo /usr/bin/find "$TARGET_RELEASE" -xdev -type f -exec /usr/bin/chown root:root -- {} +
sudo /usr/bin/find "$TARGET_RELEASE" -xdev -type d -exec /usr/bin/chmod 0755 -- {} +
sudo /usr/bin/find "$TARGET_RELEASE" -xdev -type f ! -path "$MANIFEST_MARKER" -exec /usr/bin/chmod 0644 -- {} +
sudo /usr/bin/chmod 0600 "$MANIFEST_MARKER"

assert_target_metadata_normalized
verify_target_manifest || stop "target manifest failed after metadata normalization"
[ "$(sudo sha256sum "$MANIFEST_MARKER" | awk '{print $1}')" = "$EXPECTED_MANIFEST_SHA" ] || stop "manifest digest changed after metadata normalization"
[ "$(sudo sha256sum "$BROKER_ENTRY" | awk '{print $1}')" = "$EXPECTED_BROKER_ENTRY_SHA" ] || stop "broker entry digest changed after metadata normalization"
echo "ISSUE151_RECOVERY_METADATA_PASS owner=root:root directories=0755 files=0644 manifest_marker=0600 candidate=$EXPECTED_CANDIDATE"

###############################################################################
# 5. Start broker once after metadata PASS, then bounded broker acceptance.
###############################################################################

CURRENT_STAGE="mutation-start-broker"
sudo /usr/bin/systemctl start "$BROKER_SERVICE" || stop "broker start failed"
wait_service_state "$BROKER_SERVICE" active || stop "broker did not become active"
new_broker_pid="$(systemctl show "$BROKER_SERVICE" -p MainPID --value)"
[[ "$new_broker_pid" =~ ^[1-9][0-9]*$ ]] || stop "invalid broker PID"
[ "$(sudo readlink -f "/proc/$new_broker_pid/cwd")" = "$TARGET_RELEASE" ] || stop "broker cwd is not target release"
[ "$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)" = "$broker_nrestarts_stopped" ] || stop "broker auto-restarted during recovery acceptance"
proc_has_gid "$new_broker_pid" "$docker_gid" || stop "broker runtime Docker group missing"
if proc_has_gid "$new_broker_pid" "$video_gid"; then stop "broker unexpectedly has video runtime group"; fi
if id -nG "$BROKER_USER" | tr ' ' '\n' | grep -Eq '^(docker|video)$'; then stop "broker persistent group boundary changed"; fi
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$BROKER_SOCKET")" = "$BROKER_USER:$BROKER_GROUP:660:socket" ] || stop "broker socket metadata mismatch"
wait_unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/health' 200 5 || stop "broker health did not become 200"
wait_unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/containers' 200 12 || stop "broker Docker current-state not 200"
wait_unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/logs/homeassistant/15m' 200 12 || stop "Home Assistant broker logs not 200"
wait_unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/logs/prometheus/24h' 200 12 || stop "Prometheus broker logs not 200"
[ "$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/logs/homeassistant/7d' 5 || true)" = 404 ] || stop "broker accepted forbidden log range"
[ "$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/logs/unknown/15m' 5 || true)" = 404 ] || stop "broker accepted forbidden log source"
[ "$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/images/json' 5 || true)" = 404 ] || stop "broker arbitrary Docker path did not fail closed"
[ "$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/events' 5 || true)" = 404 ] || stop "broker Docker events path unexpectedly enabled"
echo "ISSUE151_RECOVERY_BROKER_PASS broker_pid=$new_broker_pid docker=200 homeassistant_logs=200 prometheus_logs=200 forbidden_range=404 forbidden_source=404 arbitrary_path=404 events_path=404"

###############################################################################
# 6. Agent cutover once, only after broker PASS.
###############################################################################

CURRENT_STAGE="mutation-restart-agent"
agent_nrestarts_before="$(systemctl show "$AGENT_SERVICE" -p NRestarts --value)"
sudo /usr/bin/systemctl restart "$AGENT_SERVICE" || stop "agent restart failed"
wait_service_state "$AGENT_SERVICE" active || stop "agent did not become active"
new_agent_pid="$(systemctl show "$AGENT_SERVICE" -p MainPID --value)"
[[ "$new_agent_pid" =~ ^[1-9][0-9]*$ ]] || stop "invalid new agent PID"
[ "$new_agent_pid" != "$agent_pid" ] || stop "agent PID did not change"
[ "$(sudo readlink -f "/proc/$new_agent_pid/cwd")" = "$TARGET_RELEASE" ] || stop "agent cwd is not target release"
[ "$(systemctl show "$AGENT_SERVICE" -p NRestarts --value)" = "$agent_nrestarts_before" ] || stop "agent auto-restarted during acceptance"
proc_has_gid "$new_agent_pid" "$broker_gid" || stop "agent runtime broker-client group missing"
if proc_has_gid "$new_agent_pid" "$docker_gid"; then stop "agent unexpectedly has Docker runtime group"; fi
if proc_has_gid "$new_agent_pid" "$video_gid"; then stop "agent unexpectedly has video runtime group"; fi

agent_host="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary' 5)" || stop "agent host probe failed"
[ "$(response_status "$agent_host")" = 200 ] || stop "agent host not 200"
agent_docker="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' 12)" || stop "agent Docker probe failed"
[ "$(response_status "$agent_docker")" = 200 ] || stop "agent Docker current-state not 200"
for pair in 'docker%3Ahomeassistant|docker:homeassistant' 'docker%3Aprometheus|docker:prometheus'; do
  encoded="${pair%%|*}"; source="${pair#*|}"
  response="$(unix_response "$WEB_USER" "$AGENT_SOCKET" "/v1/logs?sourceId=$encoded&range=15m" 12)" || stop "agent log transport failed: $source"
  [ "$(response_status "$response")" = 200 ] || stop "agent logs not 200: $source"
  validate_log_snapshot "$(response_body "$response")" "$source" 15m || stop "agent log snapshot invalid: $source"
done
agent_events="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' 5 || true)"
[ "$(response_status "$agent_events")" = 503 ] || stop "Docker events should remain 503 pending #126"
agent_quick="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' 5)" || stop "Quick Commands agent probe failed"
[ "$(response_status "$agent_quick")" = 200 ] || stop "Quick Commands changed"
validate_quick_catalog "$(response_body "$agent_quick")" || stop "Quick Commands catalog changed"
[ ! -S "$TERMINAL_SOCKET" ] || stop "terminal/PTTY appeared after agent restart"
echo "ISSUE151_RECOVERY_AGENT_PASS agent_pid=$new_agent_pid host=200 docker=200 homeassistant_logs=200 prometheus_logs=200 events=503 quick=200 terminal=absent"

###############################################################################
# 7. Web cutover once, only after agent PASS.
###############################################################################

CURRENT_STAGE="mutation-restart-web"
web_nrestarts_before="$(systemctl show "$WEB_SERVICE" -p NRestarts --value)"
sudo /usr/bin/systemctl restart "$WEB_SERVICE" || stop "web restart failed"
wait_service_state "$WEB_SERVICE" active || stop "web did not become active"
new_web_pid="$(systemctl show "$WEB_SERVICE" -p MainPID --value)"
[[ "$new_web_pid" =~ ^[1-9][0-9]*$ ]] || stop "invalid new web PID"
[ "$new_web_pid" != "$web_pid" ] || stop "web PID did not change"
[ "$(sudo readlink -f "/proc/$new_web_pid/cwd")" = "$TARGET_RELEASE" ] || stop "web cwd is not target release"
[ "$(systemctl show "$WEB_SERVICE" -p NRestarts --value)" = "$web_nrestarts_before" ] || stop "web auto-restarted during acceptance"
if proc_has_gid "$new_web_pid" "$broker_gid"; then stop "web unexpectedly has broker-client runtime group"; fi
if proc_has_gid "$new_web_pid" "$docker_gid"; then stop "web unexpectedly has Docker runtime group"; fi
if proc_has_gid "$new_web_pid" "$video_gid"; then stop "web unexpectedly has video runtime group"; fi

web_root="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/)" || stop "web root probe failed"
[ "$web_root" = 200 ] || stop "web root not 200"
web_host="$(loopback_response '/api/current/host' 5)" || stop "web host probe failed"
[ "$(response_status "$web_host")" = 200 ] || stop "web host not 200"
web_docker="$(loopback_response '/api/current/docker' 12)" || stop "web Docker probe failed"
[ "$(response_status "$web_docker")" = 200 ] || stop "web Docker current-state not 200"
for pair in 'docker%3Ahomeassistant|docker:homeassistant' 'docker%3Aprometheus|docker:prometheus'; do
  encoded="${pair%%|*}"; source="${pair#*|}"
  response="$(loopback_response "/api/logs?sourceId=$encoded&range=15m" 12)" || stop "web log transport failed: $source"
  [ "$(response_status "$response")" = 200 ] || stop "web logs not 200: $source"
  validate_log_snapshot "$(response_body "$response")" "$source" 15m || stop "web log snapshot invalid: $source"
done
echo "ISSUE151_RECOVERY_WEB_PASS web_pid=$new_web_pid root=200 host=200 docker=200 homeassistant_logs=200 prometheus_logs=200"

###############################################################################
# 8. Final immutable/trust-boundary proof.
###############################################################################

CURRENT_STAGE="postmutation-final-proof"
[ "$(readlink "$CURRENT_LINK")" = "releases/$TARGET" ] || stop "final current pointer drift"
assert_target_metadata_normalized
verify_target_manifest || stop "final target manifest verification failed"
[ "$(sudo sha256sum "$BROKER_UNIT" | awk '{print $1}')" = "$broker_unit_sha" ] || stop "broker unit changed"
[ "$(sudo sha256sum "$AGENT_UNIT" | awk '{print $1}')" = "$agent_unit_sha" ] || stop "agent unit changed"
[ "$(sudo sha256sum "$WEB_UNIT" | awk '{print $1}')" = "$web_unit_sha" ] || stop "web unit changed"
[ "$(sudo sha256sum "$QUICK_DROPIN" | awk '{print $1}')" = "$quick_dropin_sha" ] || stop "Quick Commands drop-in changed"
[ "$(sudo stat -Lc '%U:%G:%a:%F' /var/run/docker.sock)" = 'root:docker:660:socket' ] || stop "Docker socket metadata changed"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$BROKER_SOCKET")" = "$BROKER_USER:$BROKER_GROUP:660:socket" ] || stop "broker socket metadata changed"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$AGENT_SOCKET")" = 'dashboard-rpi5-agent:dashboard-rpi5-agent-client:660:socket' ] || stop "agent socket metadata changed"
for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then stop "final main agent persistent group boundary violated: $forbidden_group"; fi
done
if id -nG "$BROKER_USER" | tr ' ' '\n' | grep -Eq '^(docker|video)$'; then stop "final broker persistent group boundary violated"; fi
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -Eq "^(docker|video|$BROKER_GROUP)$"; then stop "final web persistent group boundary violated"; fi
proc_has_gid "$new_agent_pid" "$broker_gid" || stop "final agent broker-client runtime group missing"
if proc_has_gid "$new_agent_pid" "$docker_gid"; then stop "final agent Docker runtime group appeared"; fi
if proc_has_gid "$new_agent_pid" "$video_gid"; then stop "final agent video runtime group appeared"; fi
proc_has_gid "$new_broker_pid" "$docker_gid" || stop "final broker Docker runtime group missing"

final_quick="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' 5)" || stop "final Quick Commands probe failed"
[ "$(response_status "$final_quick")" = 200 ] || stop "final Quick Commands not 200"
validate_quick_catalog "$(response_body "$final_quick")" || stop "final Quick Commands catalog drift"
final_events="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' 5 || true)"
[ "$(response_status "$final_events")" = 503 ] || stop "final Docker events not 503"
[ ! -S "$TERMINAL_SOCKET" ] || stop "terminal/PTTY present at final proof"
access_after="$(access_probe)" || stop "final Cloudflare Access probe failed"
printf '%s' "$access_after" | grep -q 'ISSUE151_ACCESS_CODE:302' || stop "final Cloudflare Access not 302"
printf '%s' "$access_after" | grep -qi '^www-authenticate:.*cloudflare-access' || stop "final Cloudflare Access marker missing"

echo "ISSUE151_RECOVERY_PASS target=$TARGET candidate=$EXPECTED_CANDIDATE previous=$PREVIOUS_RELEASE current=$TARGET broker_pid=$new_broker_pid agent_pid=$new_agent_pid web_pid=$new_web_pid host=200 docker=200 homeassistant_logs=200 prometheus_logs=200 events=503 quick=200 terminal=absent access=302"
echo "ISSUE151_RECOVERY_FINAL permission_recovery=YES release_owner=root:root release_directories=0755 release_files=0644 manifest_marker=0600 broker_loop_quiesced=YES broker_start=ONE agent_restart=ONE web_restart=ONE systemd_unit_mutation=NO identity_group_mutation=NO cloudflare=UNCHANGED terminal=absent events=503 durable_release_controller_fix=PENDING"
