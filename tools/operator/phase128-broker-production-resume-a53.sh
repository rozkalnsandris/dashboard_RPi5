#!/usr/bin/env bash
set -Eeuo pipefail

TARGET="a53fb31c33d872ec4b434d5c999d5469e1989f14"
OLD_RELEASE="73c51f3446395c51ea010831c4614777264fae3e"
EXPECTED_CI_RUN="292"
EXPECTED_CI_RUN_ID="32145819408"
EXPECTED_CANDIDATE="73c531ab3023e7072dddf60361c77f759ab675e64652932180ef4fc21e257b32"
EXPECTED_BROKER_PID="1760676"
EXPECTED_AGENT_PID="359674"
EXPECTED_WEB_PID="359766"
EXPECTED_BROKER_UNIT_SHA="fe23347534fd7c3ffba431b5aa2d7640153d93ed9b4c7b0a5b75ea208147b3e7"
EXPECTED_AGENT_UNIT_SHA="00ae0a43e88ea85823d03d7971c9ac3fd56e531fcfddecea20957daaddae70b9"
EXPECTED_WEB_UNIT_SHA="d9d79662bf7a8975d664ed3b6a2bb62c20cc83fde6e98c7e5695ff64e9a2d7ef"
EXPECTED_OWNER_ACK="I_AUTHORIZE_PHASE128_A53_RESUME_AGENT_WEB_CUTOVER_73C531AB"

REPO_SLUG="rozkalnsandris/dashboard_RPi5"
PROD_ROOT="/opt/dashboard_RPi5"
TARGET_RELEASE="$PROD_ROOT/releases/$TARGET"
OLD_RELEASE_PATH="$PROD_ROOT/releases/$OLD_RELEASE"
LOCK_PATH="$PROD_ROOT/.dashboard-release-controller.lock"

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

MUTATION_STARTED="NO"
CURRENT_STAGE="preauthorization"

stop() {
  echo "PHASE128_A53_RESUME_BLOCKED stage=$CURRENT_STAGE reason=$*" >&2
  exit 1
}

on_exit() {
  rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ "$MUTATION_STARTED" = "YES" ]; then
      echo "PHASE128_A53_RESUME_EXIT=$rc MUTATION_STARTED=YES AUTHORIZATION_CONSUMED=YES AUTO_RETRY=NO AUTO_ROLLBACK=NO AUTO_CLEANUP=NO BROKER_RESTART=NO RELEASE_MUTATION=NO IDENTITY_MUTATION=NO SYSTEMD_UNIT_MUTATION=NO CLOUDFLARE_MUTATION=NO TERMINAL_MUTATION=NO QUICK_COMMANDS_MUTATION=NO" >&2
    else
      echo "PHASE128_A53_RESUME_EXIT=$rc MUTATION_STARTED=NO AUTHORIZATION_CONSUMED=NO PRODUCTION_MUTATION=NO AUTO_RETRY=NO AUTO_CLEANUP=NO" >&2
    fi
  fi
}
trap on_exit EXIT

need() {
  command -v "$1" >/dev/null 2>&1 || stop "missing command: $1"
}

for command_name in curl jq systemctl readlink stat id getent grep awk sed sudo tail tr sleep sha256sum; do
  need "$command_name"
done

[ "$(id -u)" -ne 0 ] || stop "run as normal operator, not root"
[ "$#" -eq 2 ] || stop "usage: $0 --owner-ack <exact-ack>"
[ "$1" = "--owner-ack" ] || stop "missing --owner-ack"
[ "$2" = "$EXPECTED_OWNER_ACK" ] || stop "owner acknowledgement mismatch"

echo "PHASE128_A53_RESUME_PREFLIGHT_START target=$TARGET candidate=$EXPECTED_CANDIDATE broker_pid=$EXPECTED_BROKER_PID agent_pid=$EXPECTED_AGENT_PID web_pid=$EXPECTED_WEB_PID"

unix_response() {
  local user="$1" socket="$2" path="$3" method="${4:-GET}"
  sudo -u "$user" curl -sS --max-time 5 --unix-socket "$socket" -X "$method" -H 'Accept: application/json' -w $'\n%{http_code}' "http://localhost$path"
}
response_status() { printf '%s' "$1" | tail -n 1; }
response_body() { printf '%s' "$1" | sed '$d'; }
access_probe() { curl -sS --max-time 10 -D - -o /dev/null -w $'\nPHASE128_ACCESS_CODE:%{http_code}\n' https://dash.rozkalns.net/; }

proc_has_gid() {
  local pid="$1" gid="$2"
  sudo awk '/^Groups:/ { for (i=2; i<=NF; i++) if ($i == wanted) found=1 } END { exit(found ? 0 : 1) }' wanted="$gid" "/proc/$pid/status"
}

# Fresh GitHub/source gate. Read-only.
CURRENT_STAGE="preauth-github"
main_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' "https://api.github.com/repos/$REPO_SLUG/branches/main")" || stop "GitHub main lookup failed"
[ "$(printf '%s' "$main_json" | jq -er '.commit.sha')" = "$TARGET" ] || stop "main drift"
runs_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' "https://api.github.com/repos/$REPO_SLUG/actions/runs?branch=main&event=push&per_page=100")" || stop "Actions lookup failed"
run_json="$(printf '%s' "$runs_json" | jq -ec --arg sha "$TARGET" '[.workflow_runs[] | select(.name == "CI" and .event == "push" and .head_branch == "main" and .head_sha == $sha)] | sort_by(.run_number, (.run_attempt // 1)) | last // empty')" || stop "CI parse failed"
[ -n "$run_json" ] || stop "exact push CI not found"
[ "$(printf '%s' "$run_json" | jq -er '.run_number')" = "$EXPECTED_CI_RUN" ] || stop "unexpected CI run"
[ "$(printf '%s' "$run_json" | jq -er '.id')" = "$EXPECTED_CI_RUN_ID" ] || stop "unexpected CI run id"
[ "$(printf '%s' "$run_json" | jq -er '.status')" = completed ] || stop "CI not completed"
[ "$(printf '%s' "$run_json" | jq -er '.conclusion')" = success ] || stop "CI not successful"

echo "PHASE128_A53_RESUME_EXACT_MAIN_CI_PASS run=$EXPECTED_CI_RUN run_id=$EXPECTED_CI_RUN_ID"

# Exact partial-cutover state. Read-only. Any drift requires a new owner decision.
CURRENT_STAGE="preauth-partial-state"
[ "$(readlink "$PROD_ROOT/current")" = "releases/$TARGET" ] || stop "current pointer is not A53 target"
[ -d "$TARGET_RELEASE" ] || stop "target release missing"
[ -d "$OLD_RELEASE_PATH" ] || stop "old release missing"
[ ! -e "$LOCK_PATH" ] || stop "release-controller lock exists"

[ "$(sudo sha256sum "$BROKER_UNIT" | awk '{print $1}')" = "$EXPECTED_BROKER_UNIT_SHA" ] || stop "installed broker unit drift"
[ "$(sudo sha256sum "$AGENT_UNIT" | awk '{print $1}')" = "$EXPECTED_AGENT_UNIT_SHA" ] || stop "installed agent unit drift"
[ "$(sudo sha256sum "$WEB_UNIT" | awk '{print $1}')" = "$EXPECTED_WEB_UNIT_SHA" ] || stop "installed web unit drift"
[ "$(sudo sha256sum "$TARGET_RELEASE/ops/systemd/dashboard-rpi5-docker-broker.service" | awk '{print $1}')" = "$EXPECTED_BROKER_UNIT_SHA" ] || stop "target release broker unit drift"
[ "$(sudo sha256sum "$TARGET_RELEASE/ops/systemd/dashboard-rpi5-agent.service" | awk '{print $1}')" = "$EXPECTED_AGENT_UNIT_SHA" ] || stop "target release agent unit drift"
[ "$(sudo sha256sum "$TARGET_RELEASE/ops/systemd/dashboard-rpi5-web.service" | awk '{print $1}')" = "$EXPECTED_WEB_UNIT_SHA" ] || stop "target release web unit drift"

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
[ "$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)" = 0 ] || stop "broker restarted since incident snapshot"
[ "$(sudo readlink -f "/proc/$broker_pid/cwd")" = "$TARGET_RELEASE" ] || stop "broker cwd drift"
[ "$(sudo readlink -f "/proc/$agent_pid/cwd")" = "$OLD_RELEASE_PATH" ] || stop "agent is no longer on old release"
[ "$(sudo readlink -f "/proc/$web_pid/cwd")" = "$OLD_RELEASE_PATH" ] || stop "web is no longer on old release"

broker_gid="$(getent group "$BROKER_GROUP" | awk -F: '{print $3}')"
docker_gid="$(getent group docker | awk -F: '{print $3}')"
video_gid="$(getent group video | awk -F: '{print $3}')"
[[ "$broker_gid" =~ ^[0-9]+$ ]] || stop "broker group unavailable"
[[ "$docker_gid" =~ ^[0-9]+$ ]] || stop "docker group unavailable"
[[ "$video_gid" =~ ^[0-9]+$ ]] || stop "video group unavailable"
[ "$(getent passwd "$BROKER_USER" | awk -F: '{print $4}')" = "$broker_gid" ] || stop "broker primary group drift"
[ "$(getent passwd "$BROKER_USER" | awk -F: '{print $6}')" = /nonexistent ] || stop "broker home drift"
[ "$(getent passwd "$BROKER_USER" | awk -F: '{print $7}')" = /usr/sbin/nologin ] || stop "broker shell drift"
if id -nG "$BROKER_USER" | tr ' ' '\n' | grep -Eq '^(docker|video)$'; then stop "broker persistent privilege group drift"; fi
for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then stop "agent persistent group boundary violated: $forbidden_group"; fi
done
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -Eq "^(docker|video|$BROKER_GROUP)$"; then stop "web persistent group boundary violated"; fi

proc_has_gid "$broker_pid" "$broker_gid" || stop "broker process missing broker-client primary group"
proc_has_gid "$broker_pid" "$docker_gid" || stop "broker process missing systemd Docker supplementary group"
if proc_has_gid "$broker_pid" "$video_gid"; then stop "broker process unexpectedly has video group"; fi

[ "$(sudo stat -Lc '%U:%G:%a:%F' "$BROKER_SOCKET")" = "$BROKER_USER:$BROKER_GROUP:660:socket" ] || stop "broker socket metadata drift"
broker_health="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/health')" || stop "broker health probe failed"
[ "$(response_status "$broker_health")" = 200 ] || stop "broker health not 200"
broker_ping="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/ping')" || stop "broker ping probe failed"
[ "$(response_status "$broker_ping")" = 200 ] || stop "broker ping not 200"
broker_version="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/version')" || stop "broker version probe failed"
[ "$(response_status "$broker_version")" = 200 ] || stop "broker version not 200"
broker_containers="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/containers')" || stop "broker containers probe failed"
[ "$(response_status "$broker_containers")" = 200 ] || stop "broker containers not 200"
broker_forbidden_get="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/images/json' || true)"
[ "$(response_status "$broker_forbidden_get")" = 404 ] || stop "broker arbitrary path not fail-closed"
broker_forbidden_events="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/events' || true)"
[ "$(response_status "$broker_forbidden_events")" = 404 ] || stop "broker events path unexpectedly enabled"
broker_forbidden_post="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/version' POST || true)"
[ "$(response_status "$broker_forbidden_post")" = 405 ] || stop "broker POST not fail-closed"

[ "$(sudo stat -Lc '%U:%G:%a:%F' "$AGENT_SOCKET")" = 'dashboard-rpi5-agent:dashboard-rpi5-agent-client:660:socket' ] || stop "existing agent socket metadata drift"
agent_health_before="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/health')" || stop "existing agent health probe failed"
[ "$(response_status "$agent_health_before")" = 200 ] || stop "existing agent health not 200"
agent_host_before="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary')" || stop "existing host probe failed"
[ "$(response_status "$agent_host_before")" = 200 ] || stop "existing host not 200"
agent_docker_before="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' || true)"
[ "$(response_status "$agent_docker_before")" = 503 ] || stop "existing agent Docker not 503"
agent_quick_before="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' || true)"
[ "$(response_status "$agent_quick_before")" = 404 ] || stop "Quick Commands not 404"
[ ! -S "$TERMINAL_SOCKET" ] || stop "terminal runtime socket exists"
[ ! -e /etc/systemd/system/dashboard-rpi5-terminal.socket ] || stop "terminal socket unit exists"
[ ! -e /etc/systemd/system/dashboard-rpi5-terminal@.service ] || stop "terminal service unit exists"

web_health_before="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/health)" || stop "web health probe failed"
[ "$web_health_before" = 200 ] || stop "web health not 200"
web_host_before="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/current/host)" || stop "web host probe failed"
[ "$web_host_before" = 200 ] || stop "web host not 200"
web_docker_before="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/current/docker)" || stop "web Docker probe failed"
[ "$web_docker_before" = 503 ] || stop "web Docker not 503 before resume"
access_before="$(access_probe)" || stop "Access preflight failed"
printf '%s' "$access_before" | grep -q 'PHASE128_ACCESS_CODE:302' || stop "Access preflight not 302"
printf '%s' "$access_before" | grep -qi '^www-authenticate:.*cloudflare-access' || stop "Access marker missing"

echo "PHASE128_A53_RESUME_PREAUTH_PASS current=$TARGET broker_pid=$broker_pid agent_pid=$agent_pid web_pid=$web_pid broker=200 old_agent_docker=503 web_docker=503 quick=404 terminal=absent access=302"
echo "PHASE128_A53_RESUME_MUTATION_BOUNDARY next=restart-agent"
echo "PHASE128_A53_RESUME_AUTHORIZATION_CONSUMES_ON_NEXT_MUTATION=YES"

# Mutation 1: restart only the main agent. No broker restart, unit install, identity, release, or Cloudflare mutation.
MUTATION_STARTED="YES"
CURRENT_STAGE="mutation-restart-agent"
echo "PHASE128_A53_RESUME_MUTATION_STARTED stage=$CURRENT_STAGE"
sudo /usr/bin/systemctl restart "$AGENT_SERVICE" || stop "agent restart command failed"

wait_service_active() {
  local service="$1" index
  for ((index=0; index<50; index+=1)); do
    [ "$(systemctl is-active "$service" 2>/dev/null || true)" = active ] && return 0
    sleep 0.2
  done
  return 1
}
wait_service_active "$AGENT_SERVICE" || stop "agent did not become active"
new_agent_pid="$(systemctl show "$AGENT_SERVICE" -p MainPID --value)"
[[ "$new_agent_pid" =~ ^[1-9][0-9]*$ ]] || stop "invalid new agent PID"
[ "$new_agent_pid" != "$agent_pid" ] || stop "agent PID did not change"
[ "$(sudo readlink -f "/proc/$new_agent_pid/cwd")" = "$TARGET_RELEASE" ] || stop "agent cwd is not A53 target"
proc_has_gid "$new_agent_pid" "$broker_gid" || stop "agent process missing broker-client supplementary group"
if proc_has_gid "$new_agent_pid" "$docker_gid"; then stop "main agent process unexpectedly has Docker group"; fi
if proc_has_gid "$new_agent_pid" "$video_gid"; then stop "main agent process unexpectedly has video group"; fi
for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then stop "main agent acquired forbidden persistent group: $forbidden_group"; fi
done

wait_agent_status() {
  local path="$1" expected="$2" index response status
  for ((index=0; index<75; index+=1)); do
    response="$(unix_response "$WEB_USER" "$AGENT_SOCKET" "$path" 2>/dev/null || true)"
    status="$(response_status "$response" 2>/dev/null || true)"
    if [ "$status" = "$expected" ]; then printf '%s' "$response"; return 0; fi
    sleep 0.2
  done
  return 1
}
agent_health_after="$(wait_agent_status '/v1/health' 200)" || stop "new agent health did not become 200"
agent_host_after="$(wait_agent_status '/v1/host/summary' 200)" || stop "new host summary did not become 200"
agent_docker_after="$(wait_agent_status '/v1/docker/containers' 200)" || stop "Docker current-state did not become 200"
agent_docker_body="$(response_body "$agent_docker_after")"
printf '%s' "$agent_docker_body" | jq -e '(.apiVersion == "1.40") and (.engineVersion | type == "string" and length > 0) and (.observedAt | type == "string" and length > 0) and (.containers | type == "array" and length > 0)' >/dev/null || stop "Docker current-state payload invalid or empty"
agent_events_after="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' || true)"
[ "$(response_status "$agent_events_after")" = 503 ] || stop "Docker events should remain 503 pending #126"
agent_logs_after="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/logs?sourceId=docker%3Ahomeassistant&range=15m' || true)"
[ "$(response_status "$agent_logs_after")" = 503 ] || stop "Docker logs should remain 503 pending #127"
agent_quick_after="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' || true)"
[ "$(response_status "$agent_quick_after")" = 404 ] || stop "Quick Commands changed after agent resume"
[ ! -S "$TERMINAL_SOCKET" ] || stop "terminal runtime socket appeared"
[ "$(systemctl show "$BROKER_SERVICE" -p MainPID --value)" = "$broker_pid" ] || stop "broker PID changed during agent resume"
[ "$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)" = 0 ] || stop "broker restarted during agent resume"
access_mid="$(access_probe)" || stop "Access probe failed after agent resume"
printf '%s' "$access_mid" | grep -q 'PHASE128_ACCESS_CODE:302' || stop "Access changed after agent resume"
printf '%s' "$access_mid" | grep -qi '^www-authenticate:.*cloudflare-access' || stop "Access marker missing after agent resume"

echo "PHASE128_A53_AGENT_RESUME_PASS new_agent_pid=$new_agent_pid host=200 docker=200 events=503 docker_logs=503 quick=404 terminal=absent access=302"

# Mutation 2: restart web only after agent acceptance.
CURRENT_STAGE="mutation-restart-web"
sudo /usr/bin/systemctl restart "$WEB_SERVICE" || stop "web restart command failed"
wait_service_active "$WEB_SERVICE" || stop "web did not become active"
new_web_pid="$(systemctl show "$WEB_SERVICE" -p MainPID --value)"
[[ "$new_web_pid" =~ ^[1-9][0-9]*$ ]] || stop "invalid new web PID"
[ "$new_web_pid" != "$web_pid" ] || stop "web PID did not change"
[ "$(sudo readlink -f "/proc/$new_web_pid/cwd")" = "$TARGET_RELEASE" ] || stop "web cwd is not A53 target"
if proc_has_gid "$new_web_pid" "$broker_gid"; then stop "web process unexpectedly has broker-client group"; fi
if proc_has_gid "$new_web_pid" "$docker_gid"; then stop "web process unexpectedly has Docker group"; fi
if proc_has_gid "$new_web_pid" "$video_gid"; then stop "web process unexpectedly has video group"; fi
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -Eq "^(docker|video|$BROKER_GROUP)$"; then stop "web persistent privilege group changed"; fi

wait_loopback_status() {
  local path="$1" expected="$2" index status
  for ((index=0; index<75; index+=1)); do
    status="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:8787$path" 2>/dev/null || true)"
    [ "$status" = "$expected" ] && return 0
    sleep 0.2
  done
  return 1
}
wait_loopback_status '/api/health' 200 || stop "loopback web health did not become 200"
wait_loopback_status '/' 200 || stop "SPA root did not become 200"
wait_loopback_status '/api/current/host' 200 || stop "web host current-state did not become 200"
wait_loopback_status '/api/current/docker' 200 || stop "web Docker current-state did not become 200"
web_docker_body="$(curl -fsS --max-time 5 http://127.0.0.1:8787/api/current/docker)" || stop "web Docker body fetch failed"
printf '%s' "$web_docker_body" | jq -e '(.apiVersion == "1.40") and (.engineVersion | type == "string" and length > 0) and (.containers | type == "array" and length > 0)' >/dev/null || stop "web Docker payload invalid or empty"

# Final immutable/trust-boundary acceptance.
CURRENT_STAGE="postmutation-final-proof"
[ "$(readlink "$PROD_ROOT/current")" = "releases/$TARGET" ] || stop "final current pointer drift"
[ "$(systemctl show "$BROKER_SERVICE" -p MainPID --value)" = "$broker_pid" ] || stop "final broker PID drift"
[ "$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)" = 0 ] || stop "final broker restart count drift"
[ "$(sudo readlink -f "/proc/$new_agent_pid/cwd")" = "$TARGET_RELEASE" ] || stop "final agent cwd drift"
[ "$(sudo readlink -f "/proc/$new_web_pid/cwd")" = "$TARGET_RELEASE" ] || stop "final web cwd drift"
[ "$(sudo sha256sum "$BROKER_UNIT" | awk '{print $1}')" = "$EXPECTED_BROKER_UNIT_SHA" ] || stop "final broker unit drift"
[ "$(sudo sha256sum "$AGENT_UNIT" | awk '{print $1}')" = "$EXPECTED_AGENT_UNIT_SHA" ] || stop "final agent unit drift"
[ "$(sudo sha256sum "$WEB_UNIT" | awk '{print $1}')" = "$EXPECTED_WEB_UNIT_SHA" ] || stop "final web unit drift"
[ "$(sudo stat -Lc '%U:%G:%a:%F' /var/run/docker.sock)" = 'root:docker:660:socket' ] || stop "Docker socket permissions changed"
for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then stop "final main agent persistent group boundary violated: $forbidden_group"; fi
done
if id -nG "$BROKER_USER" | tr ' ' '\n' | grep -Eq '^(docker|video)$'; then stop "final broker persistent group boundary violated"; fi
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -Eq "^(docker|video|$BROKER_GROUP)$"; then stop "final web persistent group boundary violated"; fi
final_quick="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' || true)"
[ "$(response_status "$final_quick")" = 404 ] || stop "Quick Commands not 404 at final proof"
final_events="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' || true)"
[ "$(response_status "$final_events")" = 503 ] || stop "Docker events not 503 at final proof"
final_logs="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/logs?sourceId=docker%3Ahomeassistant&range=15m' || true)"
[ "$(response_status "$final_logs")" = 503 ] || stop "Docker logs not 503 at final proof"
[ ! -S "$TERMINAL_SOCKET" ] || stop "terminal runtime socket present at final proof"
access_after="$(access_probe)" || stop "final Access probe failed"
printf '%s' "$access_after" | grep -q 'PHASE128_ACCESS_CODE:302' || stop "final Access not 302"
printf '%s' "$access_after" | grep -qi '^www-authenticate:.*cloudflare-access' || stop "final Access marker missing"

echo "PHASE128_A53_RESUME_PASS target=$TARGET candidate=$EXPECTED_CANDIDATE broker_pid=$broker_pid agent_pid=$new_agent_pid web_pid=$new_web_pid host=200 docker=200 events=503 docker_logs=503 quick=404 terminal=absent access=302"
echo "PHASE128_A53_RESUME_FINAL production_deploy=YES bounded_docker_broker=ACTIVE agent_cutover=COMPLETE web_cutover=COMPLETE broker_restart=NO release_mutation=NO identity_mutation=NO systemd_unit_mutation=NO main_agent_docker_group=NO main_agent_video_group=NO cloudflare=UNCHANGED quick=404 terminal=absent"
