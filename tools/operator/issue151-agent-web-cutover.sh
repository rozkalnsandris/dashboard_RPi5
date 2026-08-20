#!/usr/bin/env bash
set -Eeuo pipefail

TARGET="4295c23de5634dcb86b5fe9f57be92416eb9a75b"
EXPECTED_TREE="df24c7e8e2047176c43f24989e4910a30fa1bc02"
REVIEWED_MAIN="2a03163f5ee336470c43281f4151fe06c03df45a"
REVIEWED_MAIN_TREE="a4e05e4682a21e9e432b537e1865f9265f57cc4c"
EXPECTED_CANDIDATE="f08677aef82d0213422a171b51efd46fa7db57b29385fdd9c5d185f2c7b83eb0"
EXPECTED_MANIFEST_SHA="5e7ed7f70987f93291567b880053a1f46d911f51ce678690fd61bc9f097c60ff"
EXPECTED_BROKER_ENTRY_SHA="a9fdbf13c704b0c9bc1d03ec5698198630a967d282644fb3440dfab2ff8de05d"
EXPECTED_AGENT_ENTRY_SHA="b44522f3998e723e7cea1a6ab136e0f57933f05925027365fc2cbda0ef47f56d"
PREVIOUS_RELEASE="15f44e3a6fdda8f2e97b26501a283f6bba915e86"
EXPECTED_BROKER_PID="1081746"
EXPECTED_BROKER_NRESTARTS="14582"
EXPECTED_AGENT_PID="3482974"
EXPECTED_WEB_PID="3378022"
EXPECTED_OWNER_ACK="I_AUTHORIZE_ISSUE151_AGENT_WEB_CUTOVER_4295C23DE5634DCB86B5FE9F57BE92416EB9A75B"

REPO_SLUG="rozkalnsandris/dashboard_RPi5"
PROD_ROOT="/opt/dashboard_RPi5"
TARGET_RELEASE="$PROD_ROOT/releases/$TARGET"
CURRENT_LINK="$PROD_ROOT/current"
MANIFEST_MARKER="$TARGET_RELEASE/.dashboard-production-candidate.json"
BROKER_ENTRY="$TARGET_RELEASE/apps/agent/dist/docker-broker-entry.js"
AGENT_ENTRY="$TARGET_RELEASE/apps/agent/dist/index.js"
BROKER_SERVICE="dashboard-rpi5-docker-broker.service"
AGENT_SERVICE="dashboard-rpi5-agent.service"
WEB_SERVICE="dashboard-rpi5-web.service"
BROKER_USER="dashboard-rpi5-docker-broker"
BROKER_GROUP="dashboard-rpi5-docker-client"
AGENT_USER="dashboard-rpi5-agent"
AGENT_GROUP="dashboard-rpi5-agent-client"
WEB_USER="dashboard-rpi5-web"
BROKER_RUNTIME_DIR="/run/dashboard-rpi5-docker-broker"
BROKER_SOCKET="$BROKER_RUNTIME_DIR/broker.sock"
AGENT_RUNTIME_DIR="/run/dashboard-rpi5"
AGENT_SOCKET="$AGENT_RUNTIME_DIR/agent.sock"
TERMINAL_SOCKET="/run/dashboard-rpi5-terminal.sock"
BROKER_UNIT="/etc/systemd/system/$BROKER_SERVICE"
AGENT_UNIT="/etc/systemd/system/$AGENT_SERVICE"
WEB_UNIT="/etc/systemd/system/$WEB_SERVICE"
BROKER_UNIT_SOURCE="$TARGET_RELEASE/ops/systemd/dashboard-rpi5-docker-broker.service"
AGENT_UNIT_SOURCE="$TARGET_RELEASE/ops/systemd/dashboard-rpi5-agent.service"
WEB_UNIT_SOURCE="$TARGET_RELEASE/ops/systemd/dashboard-rpi5-web.service"
QUICK_DROPIN="/etc/systemd/system/dashboard-rpi5-agent.service.d/10-quick-commands.conf"
NODE_BIN="/usr/bin/node"

MODE=""
MUTATION_STARTED="NO"
CURRENT_STAGE="argument-parse"

stop() {
  printf 'ISSUE151_CUTOVER_BLOCKED stage=%s reason=%s\n' "$CURRENT_STAGE" "$*" >&2
  exit 1
}

on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ "$MUTATION_STARTED" = YES ]; then
      printf '%s\n' \
        "ISSUE151_CUTOVER_EXIT=$rc" \
        "MUTATION_STARTED=YES" \
        "AUTHORIZATION_CONSUMED=YES" \
        "AUTO_RETRY=NO" \
        "AUTO_ROLLBACK=NO" \
        "AUTO_CLEANUP=NO" \
        "BROKER_MUTATION=NO" \
        "PERMISSION_MUTATION=NO" \
        "SYSTEMD_UNIT_MUTATION=NO" \
        "IDENTITY_GROUP_MUTATION=NO" \
        "CLOUDFLARE_MUTATION=NO" \
        "TERMINAL_MUTATION=NO" \
        "EVENTS_MUTATION=NO" \
        "ACTIONS_MUTATION=NO" >&2
    else
      printf '%s\n' \
        "ISSUE151_CUTOVER_EXIT=$rc" \
        "MUTATION_STARTED=NO" \
        "AUTHORIZATION_CONSUMED=NO" \
        "PRODUCTION_MUTATION=NO" \
        "AUTO_RETRY=NO" \
        "AUTO_CLEANUP=NO" >&2
    fi
  fi
}
trap on_exit EXIT

need() {
  command -v "$1" >/dev/null 2>&1 || stop "missing command: $1"
}

for command_name in curl jq sha256sum systemctl readlink stat id getent grep awk sed sudo tail tr sleep find cut; do
  need "$command_name"
done
[ "$(id -u)" -ne 0 ] || stop "run as normal operator, not root"
[ -x "$NODE_BIN" ] || stop "systemd Node binary missing: $NODE_BIN"

if [ "$#" -eq 1 ] && [ "$1" = "--preflight-only" ]; then
  MODE="preflight"
elif [ "$#" -eq 2 ] && [ "$1" = "--owner-ack" ]; then
  MODE="recover"
  [ "$2" = "$EXPECTED_OWNER_ACK" ] || stop "owner acknowledgement mismatch"
else
  stop "usage: $0 --preflight-only | --owner-ack <exact-ack>"
fi

printf 'ISSUE151_CUTOVER_START mode=%s target=%s previous=%s reviewed_main=%s broker_pid=%s broker_nrestarts=%s\n' \
  "$MODE" "$TARGET" "$PREVIOUS_RELEASE" "$REVIEWED_MAIN" "$EXPECTED_BROKER_PID" "$EXPECTED_BROKER_NRESTARTS"

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

loopback_status_only() {
  local path="$1" timeout="${2:-5}"
  curl -sS --max-time "$timeout" -o /dev/null -w '%{http_code}' \
    "http://127.0.0.1:8787$path"
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

privileged_socket_exists() {
  sudo test -S "$1"
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

verify_target_manifest() {
  sudo "$NODE_BIN" "$TARGET_RELEASE/tools/production-candidate-manifest.mjs" \
    --root "$TARGET_RELEASE" --sha "$TARGET" --verify "$MANIFEST_MARKER" \
    | grep -q '"status":"PASS"'
}

assert_target_metadata_normalized() {
  local bad_owner bad_group bad_dir bad_file marker_mode
  bad_owner="$(sudo find "$TARGET_RELEASE" -xdev \( -type d -o -type f \) ! -user root -print -quit)"
  [ -z "$bad_owner" ] || stop "target non-root owner: $bad_owner"
  bad_group="$(sudo find "$TARGET_RELEASE" -xdev \( -type d -o -type f \) ! -group root -print -quit)"
  [ -z "$bad_group" ] || stop "target non-root group: $bad_group"
  bad_dir="$(sudo find "$TARGET_RELEASE" -xdev -type d ! -perm 0755 -print -quit)"
  [ -z "$bad_dir" ] || stop "target directory mode drift: $bad_dir"
  bad_file="$(sudo find "$TARGET_RELEASE" -xdev -type f ! -path "$MANIFEST_MARKER" ! -perm 0644 -print -quit)"
  [ -z "$bad_file" ] || stop "target file mode drift: $bad_file"
  marker_mode="$(sudo stat -Lc '%a' "$MANIFEST_MARKER")"
  [ "$marker_mode" = 600 ] || stop "manifest marker mode drift: $marker_mode"
}

assert_broker_healthy_exact() {
  local pid nrestarts cwd runtime_meta socket_meta
  [ "$(systemctl is-active "$BROKER_SERVICE")" = active ] || stop "broker not active"
  [ "$(systemctl show "$BROKER_SERVICE" -p Result --value)" = success ] || stop "broker result drift"
  [ "$(systemctl show "$BROKER_SERVICE" -p ExecMainStatus --value)" = 0 ] || stop "broker exec status drift"
  [ "$(systemctl show "$BROKER_SERVICE" -p Restart --value)" = on-failure ] || stop "broker restart policy drift"
  pid="$(systemctl show "$BROKER_SERVICE" -p MainPID --value)"
  nrestarts="$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)"
  [ "$pid" = "$EXPECTED_BROKER_PID" ] || stop "broker PID drift: $pid"
  [ "$nrestarts" = "$EXPECTED_BROKER_NRESTARTS" ] || stop "broker NRestarts drift: $nrestarts"
  cwd="$(sudo readlink -f "/proc/$pid/cwd")"
  [ "$cwd" = "$TARGET_RELEASE" ] || stop "broker cwd drift"
  runtime_meta="$(sudo stat -Lc '%U:%G:%a:%F' "$BROKER_RUNTIME_DIR")"
  [ "$runtime_meta" = "$BROKER_USER:$BROKER_GROUP:750:directory" ] || stop "broker runtime dir metadata drift: $runtime_meta"
  privileged_socket_exists "$BROKER_SOCKET" || stop "broker socket absent"
  socket_meta="$(sudo stat -Lc '%U:%G:%a:%F' "$BROKER_SOCKET")"
  [ "$socket_meta" = "$BROKER_USER:$BROKER_GROUP:660:socket" ] || stop "broker socket metadata drift: $socket_meta"
  [ "$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/health' 5)" = 200 ] || stop "broker health not 200"
  [ "$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/containers' 12)" = 200 ] || stop "broker Docker not 200"
  [ "$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/logs/homeassistant/15m' 12)" = 200 ] || stop "broker HA logs not 200"
  [ "$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/logs/prometheus/24h' 12)" = 200 ] || stop "broker Prometheus logs not 200"
  [ "$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/logs/homeassistant/7d' 5 || true)" = 404 ] || stop "broker forbidden range changed"
  [ "$(unix_status_only "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/events' 5 || true)" = 404 ] || stop "broker events path changed"
}

wait_agent_ready() {
  local expected_pid="$1" expected_nrestarts="$2" index active pid nr cwd meta status
  for ((index=0; index<75; index+=1)); do
    active="$(systemctl is-active "$AGENT_SERVICE" 2>/dev/null || true)"
    pid="$(systemctl show "$AGENT_SERVICE" -p MainPID --value)"
    nr="$(systemctl show "$AGENT_SERVICE" -p NRestarts --value)"
    [ "$active" = active ] || return 2
    [ "$pid" = "$expected_pid" ] || return 3
    [ "$nr" = "$expected_nrestarts" ] || return 4
    if sudo test -d "/proc/$pid"; then
      cwd="$(sudo readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
      [ "$cwd" = "$TARGET_RELEASE" ] || return 5
    fi
    if privileged_socket_exists "$AGENT_SOCKET"; then
      meta="$(sudo stat -Lc '%U:%G:%a:%F' "$AGENT_SOCKET" 2>/dev/null || true)"
      if [ "$meta" = "$AGENT_USER:$AGENT_GROUP:660:socket" ]; then
        status="$(unix_status_only "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary' 5 2>/dev/null || true)"
        [ "$status" = 200 ] && return 0
      fi
    fi
    sleep 0.2
  done
  return 1
}

wait_web_ready() {
  local expected_pid="$1" expected_nrestarts="$2" index active pid nr cwd status
  for ((index=0; index<75; index+=1)); do
    active="$(systemctl is-active "$WEB_SERVICE" 2>/dev/null || true)"
    pid="$(systemctl show "$WEB_SERVICE" -p MainPID --value)"
    nr="$(systemctl show "$WEB_SERVICE" -p NRestarts --value)"
    [ "$active" = active ] || return 2
    [ "$pid" = "$expected_pid" ] || return 3
    [ "$nr" = "$expected_nrestarts" ] || return 4
    if sudo test -d "/proc/$pid"; then
      cwd="$(sudo readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
      [ "$cwd" = "$TARGET_RELEASE" ] || return 5
    fi
    status="$(loopback_status_only '/api/health' 5 2>/dev/null || true)"
    [ "$status" = 200 ] && return 0
    sleep 0.2
  done
  return 1
}

###############################################################################
# 1. Read-only source/target/provenance binding.
###############################################################################

CURRENT_STAGE="preflight-source-target"
for issue in 151 127; do
  issue_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
    "https://api.github.com/repos/$REPO_SLUG/issues/$issue")" || stop "GitHub issue #$issue lookup failed"
  [ "$(printf '%s' "$issue_json" | jq -er '.state')" = open ] || stop "issue #$issue is not open"
done

incident_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/commits/$TARGET")" || stop "GitHub target commit lookup failed"
[ "$(printf '%s' "$incident_json" | jq -er '.sha')" = "$TARGET" ] || stop "target SHA drift"
[ "$(printf '%s' "$incident_json" | jq -er '.commit.tree.sha')" = "$EXPECTED_TREE" ] || stop "target tree drift"

reviewed_main_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/commits/$REVIEWED_MAIN")" || stop "reviewed main lookup failed"
[ "$(printf '%s' "$reviewed_main_json" | jq -er '.sha')" = "$REVIEWED_MAIN" ] || stop "reviewed main SHA drift"
[ "$(printf '%s' "$reviewed_main_json" | jq -er '.commit.tree.sha')" = "$REVIEWED_MAIN_TREE" ] || stop "reviewed main tree drift"

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
' >/dev/null || stop "current main is not a safe descendant of reviewed main"

[ "$(readlink "$CURRENT_LINK")" = "releases/$TARGET" ] || stop "current pointer drift"
[ -d "$TARGET_RELEASE" ] || stop "target release missing"
sudo test -f "$MANIFEST_MARKER" || stop "manifest marker missing"
[ "$(sudo sha256sum "$MANIFEST_MARKER" | awk '{print $1}')" = "$EXPECTED_MANIFEST_SHA" ] || stop "manifest digest drift"
[ "$(sudo jq -er '.candidateSha256' "$MANIFEST_MARKER")" = "$EXPECTED_CANDIDATE" ] || stop "candidate digest drift"
[ "$(sudo jq -er '.sourceSha' "$MANIFEST_MARKER")" = "$TARGET" ] || stop "source SHA drift"
verify_target_manifest || stop "target manifest verification failed"
[ "$(sudo sha256sum "$BROKER_ENTRY" | awk '{print $1}')" = "$EXPECTED_BROKER_ENTRY_SHA" ] || stop "broker entry digest drift"
[ "$(sudo sha256sum "$AGENT_ENTRY" | awk '{print $1}')" = "$EXPECTED_AGENT_ENTRY_SHA" ] || stop "agent entry digest drift"
assert_target_metadata_normalized

node_version="$("$NODE_BIN" -p 'process.versions.node')"
node_major="${node_version%%.*}"
node_rest="${node_version#*.}"
node_minor="${node_rest%%.*}"
[ "$node_major" -eq 24 ] && [ "$node_minor" -ge 2 ] || stop "systemd Node runtime is below 24.2: $node_version"

for pair in "$BROKER_UNIT|$BROKER_UNIT_SOURCE" "$AGENT_UNIT|$AGENT_UNIT_SOURCE" "$WEB_UNIT|$WEB_UNIT_SOURCE"; do
  installed="${pair%%|*}"
  source="${pair#*|}"
  [ "$(sudo sha256sum "$installed" | awk '{print $1}')" = "$(sudo sha256sum "$source" | awk '{print $1}')" ] \
    || stop "installed unit drift: $installed"
done

broker_unit_sha="$(sudo sha256sum "$BROKER_UNIT" | awk '{print $1}')"
agent_unit_sha="$(sudo sha256sum "$AGENT_UNIT" | awk '{print $1}')"
web_unit_sha="$(sudo sha256sum "$WEB_UNIT" | awk '{print $1}')"
quick_dropin_sha="$(sudo sha256sum "$QUICK_DROPIN" | awk '{print $1}')"

###############################################################################
# 2. Read-only live boundary. Healthy broker is an invariant, never a mutation.
###############################################################################

CURRENT_STAGE="preflight-live"
[ "$(systemctl is-active docker.service)" = active ] || stop "Docker service not active"
assert_broker_healthy_exact

docker_gid="$(getent group docker | cut -d: -f3)"
broker_gid="$(getent group "$BROKER_GROUP" | cut -d: -f3)"
video_gid="$(getent group video | cut -d: -f3)"
[[ "$docker_gid" =~ ^[0-9]+$ && "$broker_gid" =~ ^[0-9]+$ && "$video_gid" =~ ^[0-9]+$ ]] || stop "required group lookup failed"

[ "$(systemctl is-active "$AGENT_SERVICE")" = active ] || stop "agent not active"
[ "$(systemctl is-active "$WEB_SERVICE")" = active ] || stop "web not active"
agent_pid="$(systemctl show "$AGENT_SERVICE" -p MainPID --value)"
web_pid="$(systemctl show "$WEB_SERVICE" -p MainPID --value)"
[ "$agent_pid" = "$EXPECTED_AGENT_PID" ] || stop "agent PID drift"
[ "$web_pid" = "$EXPECTED_WEB_PID" ] || stop "web PID drift"
[ "$(sudo readlink -f "/proc/$agent_pid/cwd")" = "$PROD_ROOT/releases/$PREVIOUS_RELEASE" ] || stop "agent cwd drift"
[ "$(sudo readlink -f "/proc/$web_pid/cwd")" = "$PROD_ROOT/releases/$PREVIOUS_RELEASE" ] || stop "web cwd drift"
agent_nrestarts_before="$(systemctl show "$AGENT_SERVICE" -p NRestarts --value)"
web_nrestarts_before="$(systemctl show "$WEB_SERVICE" -p NRestarts --value)"

for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then stop "agent persistent group boundary violated: $forbidden_group"; fi
done
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -Eq "^(docker|video|$BROKER_GROUP)$"; then stop "web persistent group boundary violated"; fi

host_pre="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary' 5)" || stop "host preflight failed"
[ "$(response_status "$host_pre")" = 200 ] || stop "host preflight not 200"
docker_pre="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' 12)" || stop "Docker preflight failed"
[ "$(response_status "$docker_pre")" = 200 ] || stop "Docker preflight not 200"
logs_pre="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/logs?sourceId=docker%3Ahomeassistant&range=15m' 5 || true)"
[ "$(response_status "$logs_pre")" = 503 ] || stop "old agent Docker logs are not expected 503"
events_pre="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' 5 || true)"
[ "$(response_status "$events_pre")" = 503 ] || stop "events preflight not 503"
quick_pre="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' 5)" || stop "Quick Commands preflight failed"
[ "$(response_status "$quick_pre")" = 200 ] || stop "Quick Commands preflight not 200"
validate_quick_catalog "$(response_body "$quick_pre")" || stop "Quick Commands catalog drift"
privileged_socket_exists "$TERMINAL_SOCKET" && stop "terminal/PTTY socket unexpectedly present"

[ "$(loopback_status_only '/api/health' 5)" = 200 ] || stop "web health preflight not 200"
[ "$(loopback_status_only '/' 5)" = 200 ] || stop "web root preflight not 200"
[ "$(loopback_status_only '/api/current/host' 5)" = 200 ] || stop "web host preflight not 200"
[ "$(loopback_status_only '/api/current/docker' 12)" = 200 ] || stop "web Docker preflight not 200"

access_pre="$(access_probe)" || stop "Cloudflare Access preflight failed"
printf '%s' "$access_pre" | grep -q 'ISSUE151_ACCESS_CODE:302' || stop "Cloudflare Access preflight not 302"
printf '%s' "$access_pre" | grep -qi '^www-authenticate:.*cloudflare-access' || stop "Cloudflare Access marker missing"

printf 'ISSUE151_CUTOVER_PREAUTH_PASS current_main=%s target=%s broker_pid=%s broker_nrestarts=%s agent_pid=%s agent_nrestarts=%s web_pid=%s web_nrestarts=%s node=%s host=200 docker=200 old_agent_logs=503 events=503 quick=200 terminal=absent access=302\n' \
  "$current_main" "$TARGET" "$EXPECTED_BROKER_PID" "$EXPECTED_BROKER_NRESTARTS" "$agent_pid" "$agent_nrestarts_before" "$web_pid" "$web_nrestarts_before" "$node_version"

if [ "$MODE" = preflight ]; then
  echo "ISSUE151_CUTOVER_PREFLIGHT_ONLY_STOP PRODUCTION_MUTATION=NO AUTHORIZATION_CONSUMED=NO BROKER_MUTATION=NO AGENT_RESTART=NO WEB_RESTART=NO PERMISSION_MUTATION=NO SYSTEMD_UNIT_MUTATION=NO IDENTITY_GROUP_MUTATION=NO CLOUDFLARE_MUTATION=NO TERMINAL_MUTATION=NO EVENTS_MUTATION=NO ACTIONS_MUTATION=NO"
  exit 0
fi

###############################################################################
# 3. Mutation boundary: agent restart exactly once.
###############################################################################

MUTATION_STARTED="YES"
CURRENT_STAGE="mutation-restart-agent"
echo "ISSUE151_CUTOVER_MUTATION_STARTED stage=$CURRENT_STAGE AUTHORIZATION_CONSUMED=YES BROKER_MUTATION=NO"
sudo /usr/bin/systemctl restart "$AGENT_SERVICE" || stop "agent restart failed"

new_agent_pid="$(systemctl show "$AGENT_SERVICE" -p MainPID --value)"
[[ "$new_agent_pid" =~ ^[1-9][0-9]*$ ]] || stop "invalid new agent PID"
[ "$new_agent_pid" != "$agent_pid" ] || stop "agent PID did not change"
wait_agent_ready "$new_agent_pid" "$agent_nrestarts_before" || stop "agent did not become application-ready"
[ "$(systemctl show "$AGENT_SERVICE" -p NRestarts --value)" = "$agent_nrestarts_before" ] || stop "agent auto-restarted during acceptance"
[ "$(sudo readlink -f "/proc/$new_agent_pid/cwd")" = "$TARGET_RELEASE" ] || stop "agent cwd is not target release"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$AGENT_SOCKET")" = "$AGENT_USER:$AGENT_GROUP:660:socket" ] || stop "agent socket metadata mismatch"
proc_has_gid "$new_agent_pid" "$broker_gid" || stop "agent runtime broker-client group missing"
if proc_has_gid "$new_agent_pid" "$docker_gid"; then stop "agent unexpectedly has Docker runtime group"; fi
if proc_has_gid "$new_agent_pid" "$video_gid"; then stop "agent unexpectedly has video runtime group"; fi

agent_host="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary' 5)" || stop "agent host probe failed"
[ "$(response_status "$agent_host")" = 200 ] || stop "agent host not 200"
agent_docker="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' 12)" || stop "agent Docker probe failed"
[ "$(response_status "$agent_docker")" = 200 ] || stop "agent Docker not 200"
for pair in 'docker%3Ahomeassistant|docker:homeassistant' 'docker%3Aprometheus|docker:prometheus'; do
  encoded="${pair%%|*}"
  source="${pair#*|}"
  response="$(unix_response "$WEB_USER" "$AGENT_SOCKET" "/v1/logs?sourceId=$encoded&range=15m" 12)" || stop "agent log transport failed: $source"
  [ "$(response_status "$response")" = 200 ] || stop "agent logs not 200: $source"
  validate_log_snapshot "$(response_body "$response")" "$source" 15m || stop "agent log snapshot invalid: $source"
done
agent_events="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' 5 || true)"
[ "$(response_status "$agent_events")" = 503 ] || stop "agent Docker events not 503"
agent_quick="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' 5)" || stop "agent Quick Commands probe failed"
[ "$(response_status "$agent_quick")" = 200 ] || stop "agent Quick Commands not 200"
validate_quick_catalog "$(response_body "$agent_quick")" || stop "agent Quick Commands catalog drift"
privileged_socket_exists "$TERMINAL_SOCKET" && stop "terminal/PTTY appeared after agent restart"

CURRENT_STAGE="post-agent-broker-reproof"
assert_broker_healthy_exact

echo "ISSUE151_CUTOVER_AGENT_PASS agent_pid=$new_agent_pid host=200 docker=200 homeassistant_logs=200 prometheus_logs=200 events=503 quick=200 terminal=absent broker_unchanged=YES"

###############################################################################
# 4. Web restart exactly once, only after agent + broker PASS.
###############################################################################

CURRENT_STAGE="mutation-restart-web"
sudo /usr/bin/systemctl restart "$WEB_SERVICE" || stop "web restart failed"

new_web_pid="$(systemctl show "$WEB_SERVICE" -p MainPID --value)"
[[ "$new_web_pid" =~ ^[1-9][0-9]*$ ]] || stop "invalid new web PID"
[ "$new_web_pid" != "$web_pid" ] || stop "web PID did not change"
wait_web_ready "$new_web_pid" "$web_nrestarts_before" || stop "web did not become application-ready"
[ "$(systemctl show "$WEB_SERVICE" -p NRestarts --value)" = "$web_nrestarts_before" ] || stop "web auto-restarted during acceptance"
[ "$(sudo readlink -f "/proc/$new_web_pid/cwd")" = "$TARGET_RELEASE" ] || stop "web cwd is not target release"
if proc_has_gid "$new_web_pid" "$broker_gid"; then stop "web unexpectedly has broker-client runtime group"; fi
if proc_has_gid "$new_web_pid" "$docker_gid"; then stop "web unexpectedly has Docker runtime group"; fi
if proc_has_gid "$new_web_pid" "$video_gid"; then stop "web unexpectedly has video runtime group"; fi

[ "$(loopback_status_only '/api/health' 5)" = 200 ] || stop "web health not 200"
[ "$(loopback_status_only '/' 5)" = 200 ] || stop "web root not 200"
web_host="$(loopback_response '/api/current/host' 5)" || stop "web host probe failed"
[ "$(response_status "$web_host")" = 200 ] || stop "web host not 200"
web_docker="$(loopback_response '/api/current/docker' 12)" || stop "web Docker probe failed"
[ "$(response_status "$web_docker")" = 200 ] || stop "web Docker not 200"
for pair in 'docker%3Ahomeassistant|docker:homeassistant' 'docker%3Aprometheus|docker:prometheus'; do
  encoded="${pair%%|*}"
  source="${pair#*|}"
  response="$(loopback_response "/api/logs?sourceId=$encoded&range=15m" 12)" || stop "web log transport failed: $source"
  [ "$(response_status "$response")" = 200 ] || stop "web logs not 200: $source"
  validate_log_snapshot "$(response_body "$response")" "$source" 15m || stop "web log snapshot invalid: $source"
done
web_quick="$(loopback_response '/api/quick-commands' 5)" || stop "web Quick Commands probe failed"
[ "$(response_status "$web_quick")" = 200 ] || stop "web Quick Commands not 200"
validate_quick_catalog "$(response_body "$web_quick")" || stop "web Quick Commands catalog drift"

echo "ISSUE151_CUTOVER_WEB_PASS web_pid=$new_web_pid health=200 root=200 host=200 docker=200 homeassistant_logs=200 prometheus_logs=200 quick=200"

###############################################################################
# 5. Final immutable/trust-boundary proof.
###############################################################################

CURRENT_STAGE="postmutation-final-proof"
[ "$(readlink "$CURRENT_LINK")" = "releases/$TARGET" ] || stop "final current pointer drift"
assert_target_metadata_normalized
verify_target_manifest || stop "final target manifest verification failed"
[ "$(sudo sha256sum "$MANIFEST_MARKER" | awk '{print $1}')" = "$EXPECTED_MANIFEST_SHA" ] || stop "final manifest digest drift"
[ "$(sudo sha256sum "$BROKER_ENTRY" | awk '{print $1}')" = "$EXPECTED_BROKER_ENTRY_SHA" ] || stop "final broker entry digest drift"
[ "$(sudo sha256sum "$AGENT_ENTRY" | awk '{print $1}')" = "$EXPECTED_AGENT_ENTRY_SHA" ] || stop "final agent entry digest drift"
[ "$(sudo sha256sum "$BROKER_UNIT" | awk '{print $1}')" = "$broker_unit_sha" ] || stop "broker unit changed"
[ "$(sudo sha256sum "$AGENT_UNIT" | awk '{print $1}')" = "$agent_unit_sha" ] || stop "agent unit changed"
[ "$(sudo sha256sum "$WEB_UNIT" | awk '{print $1}')" = "$web_unit_sha" ] || stop "web unit changed"
[ "$(sudo sha256sum "$QUICK_DROPIN" | awk '{print $1}')" = "$quick_dropin_sha" ] || stop "Quick Commands drop-in changed"
assert_broker_healthy_exact

[ "$(systemctl show "$AGENT_SERVICE" -p MainPID --value)" = "$new_agent_pid" ] || stop "final agent PID drift"
[ "$(systemctl show "$AGENT_SERVICE" -p NRestarts --value)" = "$agent_nrestarts_before" ] || stop "final agent NRestarts drift"
[ "$(sudo readlink -f "/proc/$new_agent_pid/cwd")" = "$TARGET_RELEASE" ] || stop "final agent cwd drift"
[ "$(systemctl show "$WEB_SERVICE" -p MainPID --value)" = "$new_web_pid" ] || stop "final web PID drift"
[ "$(systemctl show "$WEB_SERVICE" -p NRestarts --value)" = "$web_nrestarts_before" ] || stop "final web NRestarts drift"
[ "$(sudo readlink -f "/proc/$new_web_pid/cwd")" = "$TARGET_RELEASE" ] || stop "final web cwd drift"

for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then stop "final agent persistent group boundary violated: $forbidden_group"; fi
done
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -Eq "^(docker|video|$BROKER_GROUP)$"; then stop "final web persistent group boundary violated"; fi
proc_has_gid "$new_agent_pid" "$broker_gid" || stop "final agent broker-client runtime group missing"
if proc_has_gid "$new_agent_pid" "$docker_gid"; then stop "final agent Docker runtime group appeared"; fi
if proc_has_gid "$new_agent_pid" "$video_gid"; then stop "final agent video runtime group appeared"; fi

final_events="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' 5 || true)"
[ "$(response_status "$final_events")" = 503 ] || stop "final events not 503"
final_quick="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' 5)" || stop "final Quick Commands probe failed"
[ "$(response_status "$final_quick")" = 200 ] || stop "final Quick Commands not 200"
validate_quick_catalog "$(response_body "$final_quick")" || stop "final Quick Commands catalog drift"
privileged_socket_exists "$TERMINAL_SOCKET" && stop "terminal/PTTY present at final proof"

access_after="$(access_probe)" || stop "final Cloudflare Access probe failed"
printf '%s' "$access_after" | grep -q 'ISSUE151_ACCESS_CODE:302' || stop "final Cloudflare Access not 302"
printf '%s' "$access_after" | grep -qi '^www-authenticate:.*cloudflare-access' || stop "final Cloudflare Access marker missing"

echo "ISSUE151_CUTOVER_PASS target=$TARGET broker_pid=$EXPECTED_BROKER_PID broker_nrestarts=$EXPECTED_BROKER_NRESTARTS agent_pid=$new_agent_pid web_pid=$new_web_pid host=200 docker=200 homeassistant_logs=200 prometheus_logs=200 events=503 quick=200 terminal=absent access=302"
echo "ISSUE151_CUTOVER_FINAL broker_mutation=NO agent_restart=ONE web_restart=ONE permission_mutation=NO systemd_unit_mutation=NO identity_group_mutation=NO cloudflare=UNCHANGED terminal=absent events=503 authorization_consumed=YES"
