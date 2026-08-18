#!/usr/bin/env bash
set -Eeuo pipefail

TARGET="a53fb31c33d872ec4b434d5c999d5469e1989f14"
EXPECTED_CURRENT="73c51f3446395c51ea010831c4614777264fae3e"
EXPECTED_CI_RUN="292"
EXPECTED_CI_RUN_ID="32145819408"
EXPECTED_CANDIDATE="73c531ab3023e7072dddf60361c77f759ab675e64652932180ef4fc21e257b32"
EXPECTED_MANIFEST_SHA="a8021e581d5c2d13f1a66c74fb6afda36a45d2eaee7d4d2f427be323932b5f1d"
EXPECTED_BROKER_UNIT_SHA="fe23347534fd7c3ffba431b5aa2d7640153d93ed9b4c7b0a5b75ea208147b3e7"
EXPECTED_AGENT_UNIT_SHA="00ae0a43e88ea85823d03d7971c9ac3fd56e531fcfddecea20957daaddae70b9"
EXPECTED_BROKER_ENTRY_SHA="b6896df0530ef5584306c901bc306ce5c6ddbadc95802181e6a24e6f3d69a7e1"
EXPECTED_INSTALLED_AGENT_UNIT_SHA="a14e72a346d7094172da13210c1598f9dd6ce1ea0a16fcd655664e77515467d8"
EXPECTED_AGENT_PID="359674"
EXPECTED_WEB_PID="359766"
EXPECTED_OWNER_ACK="I_AUTHORIZE_PHASE128_A53_DOCKER_BROKER_PRODUCTION_ACTIVATION_73C531AB"
RELEASE_ACK="I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ACTIVATION"

REPO_SLUG="rozkalnsandris/dashboard_RPi5"
PROD_ROOT="/opt/dashboard_RPi5"
CURRENT_RELEASE="$PROD_ROOT/releases/$EXPECTED_CURRENT"
TARGET_RELEASE="$PROD_ROOT/releases/$TARGET"
LOCK_PATH="$PROD_ROOT/.dashboard-release-controller.lock"
WORKSPACE="$HOME/.cache/dashboard-rpi5-candidate-prep/$TARGET-r2"
REPO="$WORKSPACE/repo"
MANIFEST="$WORKSPACE/production-candidate.json"

BROKER_USER="dashboard-rpi5-docker-broker"
BROKER_GROUP="dashboard-rpi5-docker-client"
OLD_INVALID_GROUP="dashboard-rpi5-docker-broker-client"
AGENT_USER="dashboard-rpi5-agent"
WEB_USER="dashboard-rpi5-web"

AGENT_SERVICE="dashboard-rpi5-agent.service"
WEB_SERVICE="dashboard-rpi5-web.service"
BROKER_SERVICE="dashboard-rpi5-docker-broker.service"
AGENT_UNIT="/etc/systemd/system/$AGENT_SERVICE"
WEB_UNIT="/etc/systemd/system/$WEB_SERVICE"
BROKER_UNIT="/etc/systemd/system/$BROKER_SERVICE"

AGENT_SOCKET="/run/dashboard-rpi5/agent.sock"
BROKER_RUNTIME="/run/dashboard-rpi5-docker-broker"
BROKER_SOCKET="$BROKER_RUNTIME/broker.sock"
TERMINAL_SOCKET="/run/dashboard-rpi5-terminal.sock"

MUTATION_STARTED="NO"
CURRENT_STAGE="preauthorization"

stop() {
  echo "PHASE128_A53_ACTIVATION_BLOCKED stage=$CURRENT_STAGE reason=$*" >&2
  exit 1
}

on_exit() {
  rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ "$MUTATION_STARTED" = "YES" ]; then
      echo "PHASE128_A53_ACTIVATION_EXIT=$rc MUTATION_STARTED=YES AUTHORIZATION_CONSUMED=YES AUTO_RETRY=NO AUTO_ROLLBACK=NO AUTO_CLEANUP=NO CLOUDFLARE_MUTATION=NO TERMINAL_MUTATION=NO QUICK_COMMANDS_MUTATION=NO" >&2
    else
      echo "PHASE128_A53_ACTIVATION_EXIT=$rc MUTATION_STARTED=NO AUTHORIZATION_CONSUMED=NO PRODUCTION_MUTATION=NO AUTO_RETRY=NO AUTO_CLEANUP=NO" >&2
    fi
  fi
}
trap on_exit EXIT

need() {
  command -v "$1" >/dev/null 2>&1 || stop "missing command: $1"
}

for command_name in curl jq git node sha256sum systemctl readlink stat id getent grep awk sed sudo tail tr sleep; do
  need "$command_name"
done

[ "$(id -u)" -ne 0 ] || stop "run as normal operator, not root"
[ "$(node -p 'process.versions.node.split(".")[0]')" = 24 ] || stop "Node major is not 24"
[ "$#" -eq 2 ] || stop "usage: $0 --owner-ack <exact-ack>"
[ "$1" = "--owner-ack" ] || stop "missing --owner-ack"
[ "$2" = "$EXPECTED_OWNER_ACK" ] || stop "owner acknowledgement mismatch"

[ "${#BROKER_USER}" -le 32 ] || stop "broker user exceeds account-name bound"
[ "${#BROKER_GROUP}" -le 32 ] || stop "broker group exceeds account-name bound"
[ "${#OLD_INVALID_GROUP}" -gt 32 ] || stop "old invalid group fixture no longer proves regression"

echo "PHASE128_A53_ACTIVATION_PREFLIGHT_START target=$TARGET candidate=$EXPECTED_CANDIDATE expected_current=$EXPECTED_CURRENT"

# Fresh exact-main and push CI. Read-only.
CURRENT_STAGE="preauth-github"
main_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' "https://api.github.com/repos/$REPO_SLUG/branches/main")" || stop "GitHub main lookup failed"
main_sha="$(printf '%s' "$main_json" | jq -er '.commit.sha')"
[ "$main_sha" = "$TARGET" ] || stop "main drift expected=$TARGET actual=$main_sha"

runs_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' "https://api.github.com/repos/$REPO_SLUG/actions/runs?branch=main&event=push&per_page=100")" || stop "Actions lookup failed"
run_json="$(printf '%s' "$runs_json" | jq -ec --arg sha "$TARGET" '[.workflow_runs[] | select(.name == "CI" and .event == "push" and .head_branch == "main" and .head_sha == $sha)] | sort_by(.run_number, (.run_attempt // 1)) | last // empty')" || stop "CI parse failed"
[ -n "$run_json" ] || stop "exact push CI not found"
run_number="$(printf '%s' "$run_json" | jq -er '.run_number')"
run_id="$(printf '%s' "$run_json" | jq -er '.id')"
run_attempt="$(printf '%s' "$run_json" | jq -er '.run_attempt // 1')"
[ "$run_number" = "$EXPECTED_CI_RUN" ] || stop "unexpected exact-main CI run: $run_number"
[ "$run_id" = "$EXPECTED_CI_RUN_ID" ] || stop "unexpected exact-main CI run id: $run_id"
[ "$(printf '%s' "$run_json" | jq -er '.status')" = completed ] || stop "CI not completed"
[ "$(printf '%s' "$run_json" | jq -er '.conclusion')" = success ] || stop "CI not successful"

jobs_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' "https://api.github.com/repos/$REPO_SLUG/actions/runs/$run_id/jobs?per_page=100")" || stop "CI jobs lookup failed"
for job_name in "check" "terminal-native (x64)" "terminal-native (arm64)"; do
  count="$(printf '%s' "$jobs_json" | jq -er --arg name "$job_name" '[.jobs[] | select(.name == $name and .status == "completed" and .conclusion == "success")] | length')"
  [ "$count" -eq 1 ] || stop "required CI job not success: $job_name count=$count"
done
echo "PHASE128_A53_EXACT_MAIN_CI_PASS run=$run_number attempt=$run_attempt run_id=$run_id"

# Prepared immutable candidate. Read-only.
CURRENT_STAGE="preauth-candidate"
[ -d "$REPO/.git" ] || stop "prepared repo missing: $REPO"
[ -f "$MANIFEST" ] || stop "prepared manifest missing: $MANIFEST"
[ "$(git -C "$REPO" rev-parse HEAD)" = "$TARGET" ] || stop "prepared repo HEAD drift"
[ "$(sha256sum "$MANIFEST" | awk '{print $1}')" = "$EXPECTED_MANIFEST_SHA" ] || stop "manifest file digest drift"
node "$REPO/tools/production-candidate-manifest.mjs" --root "$REPO" --sha "$TARGET" --verify "$MANIFEST" | grep -q '"status":"PASS"' || stop "candidate manifest verification failed"
[ "$(jq -er '.candidateSha256' "$MANIFEST")" = "$EXPECTED_CANDIDATE" ] || stop "candidate digest drift"
[ "$(jq -er '.fileCount' "$MANIFEST")" -eq 61 ] || stop "candidate file count drift"
[ "$(jq -er '.totalBytes' "$MANIFEST")" -eq 6523540 ] || stop "candidate byte count drift"

manifest_sha_for() {
  jq -er --arg path "$1" '.files[] | select(.path == $path) | .sha256' "$MANIFEST"
}
[ "$(manifest_sha_for 'ops/systemd/dashboard-rpi5-docker-broker.service')" = "$EXPECTED_BROKER_UNIT_SHA" ] || stop "broker unit candidate hash drift"
[ "$(manifest_sha_for 'ops/systemd/dashboard-rpi5-agent.service')" = "$EXPECTED_AGENT_UNIT_SHA" ] || stop "agent unit candidate hash drift"
[ "$(manifest_sha_for 'apps/agent/dist/docker-broker-entry.js')" = "$EXPECTED_BROKER_ENTRY_SHA" ] || stop "broker entry candidate hash drift"
candidate_web_unit_sha="$(manifest_sha_for 'ops/systemd/dashboard-rpi5-web.service')"
[ "$(sha256sum "$REPO/ops/systemd/dashboard-rpi5-docker-broker.service" | awk '{print $1}')" = "$EXPECTED_BROKER_UNIT_SHA" ] || stop "broker source unit hash drift"
[ "$(sha256sum "$REPO/ops/systemd/dashboard-rpi5-agent.service" | awk '{print $1}')" = "$EXPECTED_AGENT_UNIT_SHA" ] || stop "agent source unit hash drift"
[ "$(sha256sum "$REPO/apps/agent/dist/docker-broker-entry.js" | awk '{print $1}')" = "$EXPECTED_BROKER_ENTRY_SHA" ] || stop "broker built entry hash drift"
grep -qx "User=$BROKER_USER" "$REPO/ops/systemd/dashboard-rpi5-docker-broker.service" || stop "broker user contract mismatch"
grep -qx "Group=$BROKER_GROUP" "$REPO/ops/systemd/dashboard-rpi5-docker-broker.service" || stop "broker group contract mismatch"
grep -qx 'SupplementaryGroups=docker' "$REPO/ops/systemd/dashboard-rpi5-docker-broker.service" || stop "broker Docker authority mismatch"
grep -qx "SupplementaryGroups=$BROKER_GROUP" "$REPO/ops/systemd/dashboard-rpi5-agent.service" || stop "agent broker-client contract mismatch"
grep -qx 'Environment=DASHBOARD_RPI5_QUICK_COMMANDS=disabled' "$REPO/ops/systemd/dashboard-rpi5-agent.service" || stop "Quick Commands source contract mismatch"
if grep -nF "$OLD_INVALID_GROUP" "$REPO/ops/systemd/dashboard-rpi5-docker-broker.service" "$REPO/ops/systemd/dashboard-rpi5-agent.service" "$REPO/apps/agent/src/docker-broker-systemd.test.ts" "$REPO/docs/PHASE3C_DOCKER_BROKER.md" >/dev/null; then
  stop "obsolete invalid broker group remains in trust-boundary source"
fi

# Fresh production state before first mutation. Read-only.
CURRENT_STAGE="preauth-production"
[ "$(readlink "$PROD_ROOT/current")" = "releases/$EXPECTED_CURRENT" ] || stop "current release drift"
[ -d "$CURRENT_RELEASE" ] || stop "current release missing"
[ ! -e "$TARGET_RELEASE" ] || stop "target release already exists"
[ ! -e "$LOCK_PATH" ] || stop "release-controller lock exists"
for service_name in "$AGENT_SERVICE" "$WEB_SERVICE"; do
  [ "$(systemctl is-active "$service_name")" = active ] || stop "$service_name not active"
  [ "$(systemctl is-enabled "$service_name")" = enabled ] || stop "$service_name not enabled"
done
agent_pid="$(systemctl show "$AGENT_SERVICE" -p MainPID --value)"
web_pid="$(systemctl show "$WEB_SERVICE" -p MainPID --value)"
[ "$agent_pid" = "$EXPECTED_AGENT_PID" ] || stop "agent PID drift expected=$EXPECTED_AGENT_PID actual=$agent_pid"
[ "$web_pid" = "$EXPECTED_WEB_PID" ] || stop "web PID drift expected=$EXPECTED_WEB_PID actual=$web_pid"
[ "$(sudo readlink -f "/proc/$agent_pid/cwd")" = "$CURRENT_RELEASE" ] || stop "agent cwd drift"
[ "$(sudo readlink -f "/proc/$web_pid/cwd")" = "$CURRENT_RELEASE" ] || stop "web cwd drift"
[ "$(sudo sha256sum "$AGENT_UNIT" | awk '{print $1}')" = "$EXPECTED_INSTALLED_AGENT_UNIT_SHA" ] || stop "installed agent unit changed since preparation"
[ -f "$WEB_UNIT" ] || stop "installed web unit missing"
[ "$(sudo sha256sum "$WEB_UNIT" | awk '{print $1}')" = "$candidate_web_unit_sha" ] || stop "installed web unit differs from exact target source"
for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then stop "main agent has forbidden persistent group: $forbidden_group"; fi
done
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -qx "$BROKER_GROUP"; then stop "web unexpectedly has broker-client group"; fi
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -Eq '^(docker|video)$'; then stop "web unexpectedly has privileged group"; fi
sock_meta="$(sudo stat -Lc '%U:%G:%a:%F' /var/run/docker.sock)" || stop "Docker socket stat failed"
[ "$sock_meta" = 'root:docker:660:socket' ] || stop "Docker socket metadata drift: $sock_meta"
getent passwd "$BROKER_USER" >/dev/null && stop "broker user already exists"
getent group "$BROKER_GROUP" >/dev/null && stop "broker client group already exists"
getent group "$OLD_INVALID_GROUP" >/dev/null && stop "old invalid broker group exists"
[ ! -e "$BROKER_UNIT" ] || stop "broker unit already installed"
[ ! -S "$BROKER_SOCKET" ] || stop "broker socket already exists"

unix_response() {
  local user="$1" socket="$2" path="$3" method="${4:-GET}"
  sudo -u "$user" curl -sS --max-time 5 --unix-socket "$socket" -X "$method" -H 'Accept: application/json' -w $'\n%{http_code}' "http://localhost$path"
}
response_status() { printf '%s' "$1" | tail -n 1; }
response_body() { printf '%s' "$1" | sed '$d'; }

agent_health_before="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/health')" || stop "agent health probe failed"
[ "$(response_status "$agent_health_before")" = 200 ] || stop "agent health not 200"
agent_host_before="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary')" || stop "host probe failed"
[ "$(response_status "$agent_host_before")" = 200 ] || stop "host summary not 200"
agent_docker_before="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' || true)"
[ "$(response_status "$agent_docker_before")" = 503 ] || stop "Docker must be 503 before activation"
agent_quick_before="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' || true)"
[ "$(response_status "$agent_quick_before")" = 404 ] || stop "Quick Commands not 404"
[ ! -S "$TERMINAL_SOCKET" ] || stop "terminal runtime socket exists"
[ ! -e /etc/systemd/system/dashboard-rpi5-terminal.socket ] || stop "terminal socket unit exists"
[ ! -e /etc/systemd/system/dashboard-rpi5-terminal@.service ] || stop "terminal service unit exists"

access_probe() { curl -sS --max-time 10 -D - -o /dev/null -w $'\nPHASE128_ACCESS_CODE:%{http_code}\n' https://dash.rozkalns.net/; }
access_before="$(access_probe)" || stop "Access preflight probe failed"
printf '%s' "$access_before" | grep -q 'PHASE128_ACCESS_CODE:302' || stop "Access preflight not 302"
printf '%s' "$access_before" | grep -qi '^www-authenticate:.*cloudflare-access' || stop "Access marker missing"

plan="$(cd "$REPO" && sudo /usr/bin/node tools/production-release-controller.mjs --candidate-root "$REPO" --manifest "$MANIFEST" --sha "$TARGET")" || stop "release-controller PLAN failed"
[ "$(printf '%s' "$plan" | jq -er '.status')" = PLAN ] || stop "release plan status mismatch"
[ "$(printf '%s' "$plan" | jq -er '.sourceSha')" = "$TARGET" ] || stop "release plan source mismatch"
[ "$(printf '%s' "$plan" | jq -er '.candidateSha256')" = "$EXPECTED_CANDIDATE" ] || stop "release plan candidate mismatch"
[ "$(printf '%s' "$plan" | jq -er '.observedCurrent')" = "$EXPECTED_CURRENT" ] || stop "release plan current mismatch"
[ "$(printf '%s' "$plan" | jq -er '.targetRelease')" = absent ] || stop "release target must be absent"
[ "$(printf '%s' "$plan" | jq -c '.operations')" = '["copy_manifest_allowlisted_release","write_verified_manifest_marker","atomic_current_symlink_swap"]' ] || stop "release operations mismatch"

echo "PHASE128_A53_PREAUTH_PASS main=$TARGET ci_run=$run_number candidate=$EXPECTED_CANDIDATE current=$EXPECTED_CURRENT agent_pid=$agent_pid web_pid=$web_pid docker=503 quick=404 terminal=absent access=302"
echo "PHASE128_A53_MUTATION_BOUNDARY next=groupadd broker_group=$BROKER_GROUP"
echo "PHASE128_A53_AUTHORIZATION_CONSUMES_ON_NEXT_MUTATION=YES"

# Mutation starts here. No mutation retry, rollback, or production cleanup follows a failure.
MUTATION_STARTED="YES"
CURRENT_STAGE="mutation-create-broker-group"
echo "PHASE128_A53_MUTATION_STARTED stage=$CURRENT_STAGE"
sudo /usr/sbin/groupadd --system "$BROKER_GROUP" || stop "broker group creation failed"
broker_gid="$(getent group "$BROKER_GROUP" | awk -F: '{print $3}')"
[[ "$broker_gid" =~ ^[0-9]+$ ]] || stop "broker group GID invalid"

CURRENT_STAGE="mutation-create-broker-user"
sudo /usr/sbin/useradd --system --gid "$BROKER_GROUP" --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin "$BROKER_USER" || stop "broker user creation failed"
broker_passwd="$(getent passwd "$BROKER_USER")" || stop "broker user missing after creation"
[ "$(printf '%s' "$broker_passwd" | awk -F: '{print $4}')" = "$broker_gid" ] || stop "broker primary GID mismatch"
[ "$(printf '%s' "$broker_passwd" | awk -F: '{print $6}')" = /nonexistent ] || stop "broker home mismatch"
[ "$(printf '%s' "$broker_passwd" | awk -F: '{print $7}')" = /usr/sbin/nologin ] || stop "broker shell mismatch"
if id -nG "$BROKER_USER" | tr ' ' '\n' | grep -Eq '^(docker|video)$'; then stop "broker account has persistent docker/video membership"; fi

CURRENT_STAGE="mutation-release-apply"
apply="$(cd "$REPO" && sudo /usr/bin/node tools/production-release-controller.mjs --candidate-root "$REPO" --manifest "$MANIFEST" --sha "$TARGET" --apply --expected-current "$EXPECTED_CURRENT" --ack "$RELEASE_ACK")" || stop "release APPLY failed"
[ "$(printf '%s' "$apply" | jq -er '.status')" = APPLIED ] || stop "release apply status mismatch"
[ "$(printf '%s' "$apply" | jq -er '.sourceSha')" = "$TARGET" ] || stop "release apply source mismatch"
[ "$(printf '%s' "$apply" | jq -er '.candidateSha256')" = "$EXPECTED_CANDIDATE" ] || stop "release apply candidate mismatch"
[ "$(printf '%s' "$apply" | jq -er '.previousRelease')" = "$EXPECTED_CURRENT" ] || stop "release previous mismatch"
[ "$(printf '%s' "$apply" | jq -er '.currentRelease')" = "$TARGET" ] || stop "release current mismatch"
[ "$(printf '%s' "$apply" | jq -er '.releasesDeleted')" -eq 0 ] || stop "release controller unexpectedly deleted release"
[ "$(readlink "$PROD_ROOT/current")" = "releases/$TARGET" ] || stop "current pointer not target after apply"
[ -d "$TARGET_RELEASE" ] || stop "target release missing after apply"
[ ! -e "$LOCK_PATH" ] || stop "release lock remains after apply"
[ "$(sudo sha256sum "$TARGET_RELEASE/ops/systemd/dashboard-rpi5-docker-broker.service" | awk '{print $1}')" = "$EXPECTED_BROKER_UNIT_SHA" ] || stop "release broker unit hash mismatch"
[ "$(sudo sha256sum "$TARGET_RELEASE/ops/systemd/dashboard-rpi5-agent.service" | awk '{print $1}')" = "$EXPECTED_AGENT_UNIT_SHA" ] || stop "release agent unit hash mismatch"
[ "$(sudo sha256sum "$TARGET_RELEASE/apps/agent/dist/docker-broker-entry.js" | awk '{print $1}')" = "$EXPECTED_BROKER_ENTRY_SHA" ] || stop "release broker entry hash mismatch"

CURRENT_STAGE="mutation-install-systemd-units"
sudo /usr/bin/install -o root -g root -m 0644 "$TARGET_RELEASE/ops/systemd/dashboard-rpi5-docker-broker.service" "$BROKER_UNIT" || stop "broker unit install failed"
sudo /usr/bin/install -o root -g root -m 0644 "$TARGET_RELEASE/ops/systemd/dashboard-rpi5-agent.service" "$AGENT_UNIT" || stop "agent unit install failed"
[ "$(sudo sha256sum "$BROKER_UNIT" | awk '{print $1}')" = "$EXPECTED_BROKER_UNIT_SHA" ] || stop "installed broker unit hash mismatch"
[ "$(sudo sha256sum "$AGENT_UNIT" | awk '{print $1}')" = "$EXPECTED_AGENT_UNIT_SHA" ] || stop "installed agent unit hash mismatch"

CURRENT_STAGE="mutation-daemon-reload"
sudo /usr/bin/systemctl daemon-reload || stop "systemd daemon-reload failed"
CURRENT_STAGE="mutation-enable-broker"
sudo /usr/bin/systemctl enable "$BROKER_SERVICE" || stop "broker enable failed"
[ "$(systemctl is-enabled "$BROKER_SERVICE")" = enabled ] || stop "broker not enabled"
CURRENT_STAGE="mutation-start-broker"
sudo /usr/bin/systemctl start "$BROKER_SERVICE" || stop "broker start failed"

wait_service_active() {
  local service="$1" index
  for ((index=0; index<50; index+=1)); do
    [ "$(systemctl is-active "$service" 2>/dev/null || true)" = active ] && return 0
    sleep 0.2
  done
  return 1
}
wait_service_active "$BROKER_SERVICE" || stop "broker did not become active"
broker_pid="$(systemctl show "$BROKER_SERVICE" -p MainPID --value)"
[[ "$broker_pid" =~ ^[1-9][0-9]*$ ]] || stop "invalid broker PID"
[ "$(sudo readlink -f "/proc/$broker_pid/cwd")" = "$TARGET_RELEASE" ] || stop "broker cwd is not target release"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$BROKER_RUNTIME")" = "$BROKER_USER:$BROKER_GROUP:750:directory" ] || stop "broker runtime metadata mismatch"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$BROKER_SOCKET")" = "$BROKER_USER:$BROKER_GROUP:660:socket" ] || stop "broker socket metadata mismatch"

docker_gid="$(getent group docker | awk -F: '{print $3}')"
video_gid="$(getent group video | awk -F: '{print $3}')"
[[ "$docker_gid" =~ ^[0-9]+$ ]] || stop "Docker group GID unavailable"
[[ "$video_gid" =~ ^[0-9]+$ ]] || stop "video group GID unavailable"
proc_has_gid() {
  local pid="$1" gid="$2"
  sudo awk '/^Groups:/ { for (i=2; i<=NF; i++) if ($i == wanted) found=1 } END { exit(found ? 0 : 1) }' wanted="$gid" "/proc/$pid/status"
}
proc_has_gid "$broker_pid" "$broker_gid" || stop "broker process missing broker group"
proc_has_gid "$broker_pid" "$docker_gid" || stop "broker process missing systemd Docker supplementary group"
if proc_has_gid "$broker_pid" "$video_gid"; then stop "broker process unexpectedly has video group"; fi

broker_health="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/health')" || stop "broker health probe failed"
[ "$(response_status "$broker_health")" = 200 ] || stop "broker health not 200"
broker_ping="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/ping')" || stop "broker Docker ping failed"
[ "$(response_status "$broker_ping")" = 200 ] || stop "broker Docker ping not 200"
broker_version="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/version')" || stop "broker Docker version failed"
[ "$(response_status "$broker_version")" = 200 ] || stop "broker Docker version not 200"
broker_containers="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/containers')" || stop "broker Docker containers failed"
[ "$(response_status "$broker_containers")" = 200 ] || stop "broker Docker containers not 200"
broker_forbidden_get="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/images/json' || true)"
[ "$(response_status "$broker_forbidden_get")" = 404 ] || stop "broker arbitrary Docker path did not fail closed"
broker_forbidden_events="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/events' || true)"
[ "$(response_status "$broker_forbidden_events")" = 404 ] || stop "broker events path unexpectedly enabled"
broker_forbidden_post="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/version' POST || true)"
[ "$(response_status "$broker_forbidden_post")" = 405 ] || stop "broker POST did not fail closed"

# Agent cutover: one restart only.
CURRENT_STAGE="mutation-restart-agent"
sudo /usr/bin/systemctl restart "$AGENT_SERVICE" || stop "agent restart command failed"
wait_service_active "$AGENT_SERVICE" || stop "agent did not become active"
new_agent_pid="$(systemctl show "$AGENT_SERVICE" -p MainPID --value)"
[[ "$new_agent_pid" =~ ^[1-9][0-9]*$ ]] || stop "invalid new agent PID"
[ "$new_agent_pid" != "$agent_pid" ] || stop "agent PID did not change"
[ "$(sudo readlink -f "/proc/$new_agent_pid/cwd")" = "$TARGET_RELEASE" ] || stop "agent cwd is not target release"
proc_has_gid "$new_agent_pid" "$broker_gid" || stop "agent process missing broker-client supplementary group"
if proc_has_gid "$new_agent_pid" "$docker_gid"; then stop "main agent process unexpectedly has Docker group"; fi
if proc_has_gid "$new_agent_pid" "$video_gid"; then stop "main agent process unexpectedly has video group"; fi
for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then stop "main agent acquired forbidden persistent group: $forbidden_group"; fi
done

wait_agent_status() {
  local path="$1" expected="$2" index response status
  for ((index=0; index<50; index+=1)); do
    response="$(unix_response "$WEB_USER" "$AGENT_SOCKET" "$path" 2>/dev/null || true)"
    status="$(response_status "$response" 2>/dev/null || true)"
    if [ "$status" = "$expected" ]; then printf '%s' "$response"; return 0; fi
    sleep 0.2
  done
  return 1
}
agent_health_after="$(wait_agent_status '/v1/health' 200)" || stop "agent health did not become 200"
agent_host_after="$(wait_agent_status '/v1/host/summary' 200)" || stop "host summary did not become 200"
agent_docker_after="$(wait_agent_status '/v1/docker/containers' 200)" || stop "Docker current-state did not become 200"
agent_docker_body="$(response_body "$agent_docker_after")"
printf '%s' "$agent_docker_body" | jq -e '(.apiVersion == "1.40") and (.engineVersion | type == "string" and length > 0) and (.observedAt | type == "string" and length > 0) and (.containers | type == "array" and length > 0)' >/dev/null || stop "Docker current-state payload invalid or empty"
agent_events_after="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' || true)"
[ "$(response_status "$agent_events_after")" = 503 ] || stop "Docker events should remain 503 pending #126"
agent_logs_after="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/logs?sourceId=docker%3Ahomeassistant&range=15m' || true)"
[ "$(response_status "$agent_logs_after")" = 503 ] || stop "Docker logs should remain 503 pending #127"
agent_quick_after="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' || true)"
[ "$(response_status "$agent_quick_after")" = 404 ] || stop "Quick Commands changed after agent cutover"
[ ! -S "$TERMINAL_SOCKET" ] || stop "terminal runtime socket appeared"
access_mid="$(access_probe)" || stop "Access probe failed after agent cutover"
printf '%s' "$access_mid" | grep -q 'PHASE128_ACCESS_CODE:302' || stop "Access changed after agent cutover"
printf '%s' "$access_mid" | grep -qi '^www-authenticate:.*cloudflare-access' || stop "Access marker missing after agent cutover"

# Web cutover: one restart only, only after agent acceptance.
CURRENT_STAGE="mutation-restart-web"
sudo /usr/bin/systemctl restart "$WEB_SERVICE" || stop "web restart command failed"
wait_service_active "$WEB_SERVICE" || stop "web did not become active"
new_web_pid="$(systemctl show "$WEB_SERVICE" -p MainPID --value)"
[[ "$new_web_pid" =~ ^[1-9][0-9]*$ ]] || stop "invalid new web PID"
[ "$new_web_pid" != "$web_pid" ] || stop "web PID did not change"
[ "$(sudo readlink -f "/proc/$new_web_pid/cwd")" = "$TARGET_RELEASE" ] || stop "web cwd is not target release"
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -Eq "^(docker|video|$BROKER_GROUP)$"; then stop "web acquired forbidden privilege group"; fi

wait_loopback_status() {
  local path="$1" expected="$2" index status
  for ((index=0; index<50; index+=1)); do
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

final_quick="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' || true)"
[ "$(response_status "$final_quick")" = 404 ] || stop "Quick Commands not 404 at final acceptance"
final_events="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' || true)"
[ "$(response_status "$final_events")" = 503 ] || stop "Docker events not fail-closed at final acceptance"
final_logs="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/logs?sourceId=docker%3Ahomeassistant&range=15m' || true)"
[ "$(response_status "$final_logs")" = 503 ] || stop "Docker logs not fail-closed at final acceptance"
[ ! -S "$TERMINAL_SOCKET" ] || stop "terminal runtime socket present at final acceptance"
[ ! -e /etc/systemd/system/dashboard-rpi5-terminal.socket ] || stop "terminal socket unit appeared"
[ ! -e /etc/systemd/system/dashboard-rpi5-terminal@.service ] || stop "terminal service unit appeared"
access_after="$(access_probe)" || stop "final Access probe failed"
printf '%s' "$access_after" | grep -q 'PHASE128_ACCESS_CODE:302' || stop "final Access not 302"
printf '%s' "$access_after" | grep -qi '^www-authenticate:.*cloudflare-access' || stop "final Access marker missing"

# Final immutable/trust-boundary proof. Read-only.
CURRENT_STAGE="postmutation-final-proof"
[ "$(readlink "$PROD_ROOT/current")" = "releases/$TARGET" ] || stop "final current pointer drift"
[ -d "$TARGET_RELEASE" ] || stop "final target release missing"
[ ! -e "$LOCK_PATH" ] || stop "final release lock exists"
for service_name in "$BROKER_SERVICE" "$AGENT_SERVICE" "$WEB_SERVICE"; do
  [ "$(systemctl is-active "$service_name")" = active ] || stop "$service_name not active at final proof"
  [ "$(systemctl is-enabled "$service_name")" = enabled ] || stop "$service_name not enabled at final proof"
done
[ "$(sudo sha256sum "$BROKER_UNIT" | awk '{print $1}')" = "$EXPECTED_BROKER_UNIT_SHA" ] || stop "final broker unit hash drift"
[ "$(sudo sha256sum "$AGENT_UNIT" | awk '{print $1}')" = "$EXPECTED_AGENT_UNIT_SHA" ] || stop "final agent unit hash drift"
[ "$(sudo sha256sum "$WEB_UNIT" | awk '{print $1}')" = "$candidate_web_unit_sha" ] || stop "final web unit hash drift"
[ "$(sudo stat -Lc '%U:%G:%a:%F' /var/run/docker.sock)" = 'root:docker:660:socket' ] || stop "Docker socket permissions changed"
for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then stop "main agent persistent group boundary violated: $forbidden_group"; fi
done
if id -nG "$BROKER_USER" | tr ' ' '\n' | grep -Eq '^(docker|video)$'; then stop "broker account gained persistent docker/video membership"; fi

echo "PHASE128_A53_ACTIVATION_PASS target=$TARGET candidate=$EXPECTED_CANDIDATE previous=$EXPECTED_CURRENT current=$TARGET broker_pid=$broker_pid agent_pid=$new_agent_pid web_pid=$new_web_pid broker_group=$BROKER_GROUP docker=200 host=200 events=503 docker_logs=503 quick=404 terminal=absent access=302"
echo "PHASE128_A53_FINAL production_deploy=YES bounded_docker_broker=ACTIVE main_agent_docker_group=NO main_agent_video_group=NO broker_docker_authority=SYSTEMD_SUPPLEMENTARY_ONLY cloudflare=UNCHANGED quick=404 terminal=absent"
