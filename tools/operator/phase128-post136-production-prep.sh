#!/usr/bin/env bash
set -Eeuo pipefail

TARGET="15f44e3a6fdda8f2e97b26501a283f6bba915e86"
EXPECTED_CURRENT="a53fb31c33d872ec4b434d5c999d5469e1989f14"
OLD_WEB_RELEASE="73c51f3446395c51ea010831c4614777264fae3e"
EXPECTED_CI_RUN="305"
EXPECTED_CI_RUN_ID="32177354491"

REPO_SLUG="rozkalnsandris/dashboard_RPi5"
PROD_ROOT="/opt/dashboard_RPi5"
CURRENT_RELEASE="$PROD_ROOT/releases/$EXPECTED_CURRENT"
OLD_WEB_RELEASE_PATH="$PROD_ROOT/releases/$OLD_WEB_RELEASE"
TARGET_RELEASE="$PROD_ROOT/releases/$TARGET"
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

WORKSPACE="$HOME/.cache/dashboard-rpi5-candidate-prep/${TARGET}-post136"
REPO="$WORKSPACE/repo"
MANIFEST="$WORKSPACE/production-candidate.json"

blocked() {
  echo "PHASE128_POST136_PREP_BLOCKED: $*" >&2
  exit 1
}

trap 'rc=$?; if [ "$rc" -ne 0 ]; then echo "PHASE128_POST136_PREP_EXIT=$rc PRODUCTION_MUTATION=NO RELEASE_APPLY=NO SYSTEMD_MUTATION=NO IDENTITY_MUTATION=NO PERMISSION_MUTATION=NO CLOUDFLARE_MUTATION=NO AUTO_RETRY=NO AUTO_CLEANUP=NO" >&2; fi' EXIT

need() {
  command -v "$1" >/dev/null 2>&1 || blocked "missing command: $1"
}

for command_name in curl jq git node npm sha256sum systemctl readlink stat id getent grep awk sed sudo tail tr find sort xargs; do
  need "$command_name"
done

[ "$(id -u)" -ne 0 ] || blocked "run as normal operator, not root"
[ "$(node -p 'process.versions.node.split(".")[0]')" = 24 ] || blocked "Node major is not 24"

printf 'PHASE128_POST136_PREP_START target=%s expected_current=%s old_web=%s workspace=%s\n' \
  "$TARGET" "$EXPECTED_CURRENT" "$OLD_WEB_RELEASE" "$WORKSPACE"

unix_response() {
  local user="$1" socket="$2" path="$3" method="${4:-GET}" timeout="${5:-12}"
  sudo -u "$user" \
    curl -sS --max-time "$timeout" \
    --unix-socket "$socket" \
    -X "$method" \
    -H 'Accept: application/json' \
    -w $'\n%{http_code}' \
    "http://localhost$path"
}

response_status() {
  printf '%s' "$1" | tail -n 1
}

response_body() {
  printf '%s' "$1" | sed '$d'
}

proc_has_gid() {
  local pid="$1" gid="$2"
  sudo awk '/^Groups:/ { for (i=2; i<=NF; i++) if ($i == wanted) found=1 } END { exit(found ? 0 : 1) }' \
    wanted="$gid" "/proc/$pid/status"
}

access_probe() {
  curl -sS --max-time 10 -D - -o /dev/null -w $'\nPHASE128_ACCESS_CODE:%{http_code}\n' \
    https://dash.rozkalns.net/
}

# 1. Fresh authoritative GitHub main + exact push->main CI.
main_json="$(curl -fsSL \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/branches/main")" \
  || blocked "GitHub main lookup failed"
main_sha="$(printf '%s' "$main_json" | jq -er '.commit.sha')"
[ "$main_sha" = "$TARGET" ] || blocked "main drift expected=$TARGET actual=$main_sha"

runs_json="$(curl -fsSL \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/actions/runs?branch=main&event=push&per_page=100")" \
  || blocked "Actions lookup failed"
run_json="$(printf '%s' "$runs_json" | jq -ec --arg sha "$TARGET" '
  [.workflow_runs[]
    | select(.name == "CI")
    | select(.event == "push")
    | select(.head_branch == "main")
    | select(.head_sha == $sha)
  ] | sort_by(.run_number, (.run_attempt // 1)) | last // empty
')" || blocked "CI parse failed"
[ -n "$run_json" ] || blocked "exact push CI not found"

run_id="$(printf '%s' "$run_json" | jq -er '.id')"
run_number="$(printf '%s' "$run_json" | jq -er '.run_number')"
run_attempt="$(printf '%s' "$run_json" | jq -er '.run_attempt // 1')"
ci_status="$(printf '%s' "$run_json" | jq -er '.status')"
ci_conclusion="$(printf '%s' "$run_json" | jq -r '.conclusion')"

[ "$run_number" = "$EXPECTED_CI_RUN" ] || blocked "unexpected CI run expected=$EXPECTED_CI_RUN actual=$run_number"
[ "$run_id" = "$EXPECTED_CI_RUN_ID" ] || blocked "unexpected CI run id expected=$EXPECTED_CI_RUN_ID actual=$run_id"
[ "$ci_status" = completed ] || blocked "CI not completed: status=$ci_status"
[ "$ci_conclusion" = success ] || blocked "CI not successful: conclusion=$ci_conclusion"

jobs_json="$(curl -fsSL \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/actions/runs/$run_id/jobs?per_page=100")" \
  || blocked "CI jobs lookup failed"

for job_name in "check" "terminal-native (x64)" "terminal-native (arm64)"; do
  count="$(printf '%s' "$jobs_json" | jq -er --arg name "$job_name" '
    [.jobs[] | select(.name == $name and .status == "completed" and .conclusion == "success")] | length
  ')"
  [ "$count" -eq 1 ] || blocked "required CI job not success: $job_name count=$count"
done

printf 'GITHUB_EXACT_MAIN_CI_PASS main=%s ci_run=%s attempt=%s run_id=%s\n' \
  "$TARGET" "$run_number" "$run_attempt" "$run_id"

# 2. Fresh read-only proof of the stopped partial production baseline.
current="$(readlink "$PROD_ROOT/current")" || blocked "current pointer unreadable"
[ "$current" = "releases/$EXPECTED_CURRENT" ] \
  || blocked "current expected=releases/$EXPECTED_CURRENT actual=$current"
[ -d "$CURRENT_RELEASE" ] || blocked "current A53 release missing"
[ -d "$OLD_WEB_RELEASE_PATH" ] || blocked "old web release missing"
[ ! -e "$TARGET_RELEASE" ] || blocked "source-fixed target release already exists"
[ ! -e "$LOCK_PATH" ] || blocked "release-controller lock exists"

sudo /usr/bin/node "$CURRENT_RELEASE/tools/production-candidate-manifest.mjs" \
  --root "$CURRENT_RELEASE" \
  --sha "$EXPECTED_CURRENT" \
  --verify "$CURRENT_RELEASE/.dashboard-production-candidate.json" \
  | grep -q '"status":"PASS"' \
  || blocked "current A53 release manifest verify failed"

for service_name in "$BROKER_SERVICE" "$AGENT_SERVICE" "$WEB_SERVICE"; do
  [ "$(systemctl is-active "$service_name")" = active ] || blocked "$service_name not active"
  [ "$(systemctl is-enabled "$service_name")" = enabled ] || blocked "$service_name not enabled"
done

broker_pid="$(systemctl show "$BROKER_SERVICE" -p MainPID --value)"
agent_pid="$(systemctl show "$AGENT_SERVICE" -p MainPID --value)"
web_pid="$(systemctl show "$WEB_SERVICE" -p MainPID --value)"
for pid in "$broker_pid" "$agent_pid" "$web_pid"; do
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || blocked "invalid service PID: $pid"
done

broker_restarts="$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)"
agent_restarts="$(systemctl show "$AGENT_SERVICE" -p NRestarts --value)"
web_restarts="$(systemctl show "$WEB_SERVICE" -p NRestarts --value)"
[ "$broker_restarts" = 0 ] || blocked "broker NRestarts drift: $broker_restarts"
[ "$agent_restarts" = 0 ] || blocked "agent NRestarts drift: $agent_restarts"
[ "$web_restarts" = 0 ] || blocked "web NRestarts drift: $web_restarts"

broker_cwd="$(sudo readlink -f "/proc/$broker_pid/cwd")" || blocked "broker cwd unreadable"
agent_cwd="$(sudo readlink -f "/proc/$agent_pid/cwd")" || blocked "agent cwd unreadable"
web_cwd="$(sudo readlink -f "/proc/$web_pid/cwd")" || blocked "web cwd unreadable"
[ "$broker_cwd" = "$CURRENT_RELEASE" ] || blocked "broker cwd drift: $broker_cwd"
[ "$agent_cwd" = "$CURRENT_RELEASE" ] || blocked "agent cwd drift: $agent_cwd"
[ "$web_cwd" = "$OLD_WEB_RELEASE_PATH" ] || blocked "web cwd drift: $web_cwd"

for unit_path in "$BROKER_UNIT" "$AGENT_UNIT" "$WEB_UNIT"; do
  [ -f "$unit_path" ] || blocked "installed unit missing: $unit_path"
done
installed_broker_unit_sha="$(sudo sha256sum "$BROKER_UNIT" | awk '{print $1}')"
installed_agent_unit_sha="$(sudo sha256sum "$AGENT_UNIT" | awk '{print $1}')"
installed_web_unit_sha="$(sudo sha256sum "$WEB_UNIT" | awk '{print $1}')"
a53_broker_unit_sha="$(sha256sum "$CURRENT_RELEASE/ops/systemd/dashboard-rpi5-docker-broker.service" | awk '{print $1}')"
a53_agent_unit_sha="$(sha256sum "$CURRENT_RELEASE/ops/systemd/dashboard-rpi5-agent.service" | awk '{print $1}')"
old_web_unit_sha="$(sha256sum "$OLD_WEB_RELEASE_PATH/ops/systemd/dashboard-rpi5-web.service" | awk '{print $1}')"
[ "$installed_broker_unit_sha" = "$a53_broker_unit_sha" ] || blocked "installed broker unit differs from A53 release"
[ "$installed_agent_unit_sha" = "$a53_agent_unit_sha" ] || blocked "installed agent unit differs from A53 release"
[ "$installed_web_unit_sha" = "$old_web_unit_sha" ] || blocked "installed web unit differs from old web release"

broker_gid="$(getent group "$BROKER_GROUP" | awk -F: '{print $3}')"
docker_gid="$(getent group docker | awk -F: '{print $3}')"
video_gid="$(getent group video | awk -F: '{print $3}')"
[[ "$broker_gid" =~ ^[0-9]+$ ]] || blocked "broker group unavailable"
[[ "$docker_gid" =~ ^[0-9]+$ ]] || blocked "docker group unavailable"
[[ "$video_gid" =~ ^[0-9]+$ ]] || blocked "video group unavailable"

getent passwd "$BROKER_USER" >/dev/null || blocked "broker user missing"
[ "$(getent passwd "$BROKER_USER" | awk -F: '{print $4}')" = "$broker_gid" ] || blocked "broker primary group drift"
[ "$(getent passwd "$BROKER_USER" | awk -F: '{print $6}')" = /nonexistent ] || blocked "broker home drift"
[ "$(getent passwd "$BROKER_USER" | awk -F: '{print $7}')" = /usr/sbin/nologin ] || blocked "broker shell drift"

if id -nG "$BROKER_USER" | tr ' ' '\n' | grep -Eq '^(docker|video)$'; then
  blocked "broker persistent privilege group drift"
fi
for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then
    blocked "agent persistent group boundary violated: $forbidden_group"
  fi
done
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -Eq "^(docker|video|$BROKER_GROUP)$"; then
  blocked "web persistent group boundary violated"
fi

proc_has_gid "$broker_pid" "$broker_gid" || blocked "broker process missing broker primary group"
proc_has_gid "$broker_pid" "$docker_gid" || blocked "broker process missing systemd Docker supplementary group"
if proc_has_gid "$broker_pid" "$video_gid"; then blocked "broker process unexpectedly has video group"; fi
proc_has_gid "$agent_pid" "$broker_gid" || blocked "agent process missing runtime broker-client group"
if proc_has_gid "$agent_pid" "$docker_gid"; then blocked "main agent process unexpectedly has Docker group"; fi
if proc_has_gid "$agent_pid" "$video_gid"; then blocked "main agent process unexpectedly has video group"; fi
if proc_has_gid "$web_pid" "$broker_gid"; then blocked "web process unexpectedly has broker-client group"; fi
if proc_has_gid "$web_pid" "$docker_gid"; then blocked "web process unexpectedly has Docker group"; fi
if proc_has_gid "$web_pid" "$video_gid"; then blocked "web process unexpectedly has video group"; fi

docker_sock_meta="$(sudo stat -Lc '%U:%G:%a:%F' /var/run/docker.sock)" || blocked "Docker socket stat failed"
[ "$docker_sock_meta" = 'root:docker:660:socket' ] || blocked "unexpected Docker socket metadata: $docker_sock_meta"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$BROKER_SOCKET")" = "$BROKER_USER:$BROKER_GROUP:660:socket" ] \
  || blocked "broker socket metadata drift"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$AGENT_SOCKET")" = 'dashboard-rpi5-agent:dashboard-rpi5-agent-client:660:socket' ] \
  || blocked "agent socket metadata drift"

broker_health="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/health')" || blocked "broker health probe failed"
[ "$(response_status "$broker_health")" = 200 ] || blocked "broker health not 200"
broker_ping="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/ping')" || blocked "broker ping probe failed"
[ "$(response_status "$broker_ping")" = 200 ] || blocked "broker ping not 200"
broker_version="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/version')" || blocked "broker version probe failed"
[ "$(response_status "$broker_version")" = 200 ] || blocked "broker version not 200"
broker_containers="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/containers')" || blocked "broker containers probe failed"
[ "$(response_status "$broker_containers")" = 200 ] || blocked "broker containers not 200"
broker_forbidden_get="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/images/json' GET 5 || true)"
[ "$(response_status "$broker_forbidden_get")" = 404 ] || blocked "broker arbitrary path not fail-closed"
broker_forbidden_events="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/events' GET 5 || true)"
[ "$(response_status "$broker_forbidden_events")" = 404 ] || blocked "broker events path unexpectedly enabled"
broker_forbidden_post="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/version' POST 5 || true)"
[ "$(response_status "$broker_forbidden_post")" = 405 ] || blocked "broker POST not fail-closed"

agent_health="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/health' GET 5)" || blocked "agent health probe failed"
[ "$(response_status "$agent_health")" = 200 ] || blocked "agent health not 200"
agent_host="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary' GET 5)" || blocked "agent host probe failed"
[ "$(response_status "$agent_host")" = 200 ] || blocked "agent host not 200"
agent_docker="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' GET 8 || true)"
[ "$(response_status "$agent_docker")" = 504 ] || blocked "A53 agent Docker must remain 504 before source-fixed activation"
printf '%s' "$(response_body "$agent_docker")" | jq -e '.error == "OPERATION_TIMEOUT"' >/dev/null \
  || blocked "A53 Docker timeout body mismatch"
agent_events="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' GET 5 || true)"
[ "$(response_status "$agent_events")" = 503 ] || blocked "Docker events should remain 503 pending #126"
agent_logs="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/logs?sourceId=docker%3Ahomeassistant&range=15m' GET 5 || true)"
[ "$(response_status "$agent_logs")" = 503 ] || blocked "Docker logs should remain 503 pending #127"
agent_quick="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' GET 5 || true)"
[ "$(response_status "$agent_quick")" = 404 ] || blocked "Quick Commands not 404"

[ ! -S "$TERMINAL_SOCKET" ] || blocked "terminal runtime socket exists"
[ ! -e /etc/systemd/system/dashboard-rpi5-terminal.socket ] || blocked "terminal socket unit exists"
[ ! -e /etc/systemd/system/dashboard-rpi5-terminal@.service ] || blocked "terminal service unit exists"

web_health="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/health)" \
  || blocked "web health probe failed"
[ "$web_health" = 200 ] || blocked "web health not 200"
web_host="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/current/host)" \
  || blocked "web host probe failed"
[ "$web_host" = 200 ] || blocked "web host not 200"
web_docker="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/current/docker || true)"
case "$web_docker" in
  503|504) ;;
  *) blocked "old web Docker endpoint unexpectedly changed: $web_docker" ;;
esac

access_before="$(access_probe)" || blocked "Access preflight failed"
printf '%s' "$access_before" | grep -q 'PHASE128_ACCESS_CODE:302' || blocked "Access expected 302"
printf '%s' "$access_before" | grep -qi '^www-authenticate:.*cloudflare-access' || blocked "Access marker missing"

printf 'PARTIAL_PRODUCTION_PREFLIGHT_PASS current=%s broker_pid=%s agent_pid=%s web_pid=%s broker=200 agent_health=200 agent_host=200 agent_docker=504 web_docker=%s quick=404 events=503 docker_logs=503 terminal=absent access=302 docker_sock=%s\n' \
  "$EXPECTED_CURRENT" "$broker_pid" "$agent_pid" "$web_pid" "$web_docker" "$docker_sock_meta"

# 3. Create a new operator-owned workspace only. Never reuse or clean an older prep workspace.
mkdir -p "$HOME/.cache/dashboard-rpi5-candidate-prep"
[ ! -e "$WORKSPACE" ] || blocked "workspace exists; no auto-reuse/cleanup: $WORKSPACE"
mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" remote add origin "https://github.com/$REPO_SLUG.git"
git -C "$REPO" fetch -q --depth=1 origin main
git -C "$REPO" checkout -q --detach FETCH_HEAD
fetched_sha="$(git -C "$REPO" rev-parse HEAD)"
[ "$fetched_sha" = "$TARGET" ] || blocked "fetched source drift expected=$TARGET actual=$fetched_sha"

broker_unit="$REPO/ops/systemd/dashboard-rpi5-docker-broker.service"
agent_unit="$REPO/ops/systemd/dashboard-rpi5-agent.service"
web_unit="$REPO/ops/systemd/dashboard-rpi5-web.service"
docker_api="$REPO/apps/agent/src/docker-api.ts"
protocol="$REPO/apps/agent/src/protocol.ts"
current_state_client="$REPO/apps/server/src/agent-current-state-client.ts"

for required_file in "$broker_unit" "$agent_unit" "$web_unit" "$docker_api" "$protocol" "$current_state_client"; do
  [ -f "$required_file" ] || blocked "required source file missing: $required_file"
done

grep -qx "User=$BROKER_USER" "$broker_unit" || blocked "broker user contract mismatch"
grep -qx "Group=$BROKER_GROUP" "$broker_unit" || blocked "broker primary group contract mismatch"
grep -qx 'SupplementaryGroups=docker' "$broker_unit" || blocked "broker Docker group contract mismatch"
grep -qx 'RestrictAddressFamilies=AF_UNIX' "$broker_unit" || blocked "broker AF_UNIX contract missing"
grep -qx "SupplementaryGroups=$BROKER_GROUP" "$agent_unit" || blocked "agent broker-client contract mismatch"
grep -qx 'Environment=DASHBOARD_RPI5_QUICK_COMMANDS=disabled' "$agent_unit" || blocked "Quick Commands source contract mismatch"

grep -qF 'export const DOCKER_CONTAINER_CONCURRENCY = 8;' "$docker_api" \
  || blocked "source-fixed Docker concurrency contract missing"
grep -qF 'export const DOCKER_CONTAINERS_OPERATION_TIMEOUT_MS = 8_000;' "$protocol" \
  || blocked "source-fixed Docker operation timeout contract missing"
grep -qF 'export const DEFAULT_OPERATION_TIMEOUT_MS = 5_000;' "$protocol" \
  || blocked "default operation timeout contract drift"
grep -qF 'export const AGENT_CURRENT_STATE_TIMEOUT_MS = 1_500;' "$current_state_client" \
  || blocked "host current-state timeout contract drift"
grep -qF 'export const AGENT_DOCKER_CURRENT_STATE_TIMEOUT_MS = 10_000;' "$current_state_client" \
  || blocked "Docker current-state timeout contract missing"

printf 'SOURCE_FIXED_CONTRACT_PASS target=%s docker_concurrency=8 docker_operation_timeout_ms=8000 host_outer_timeout_ms=1500 docker_outer_timeout_ms=10000\n' \
  "$TARGET"

# 4. Deterministic exact-main validation/build.
(
  cd "$REPO"
  npm ci --ignore-scripts
  npm audit --audit-level=high
  npm run check
) || blocked "validation/build failed"

broker_entry="$REPO/apps/agent/dist/docker-broker-entry.js"
agent_entry="$REPO/apps/agent/dist/index.js"
server_dist="$REPO/apps/server/dist"
for required_build in "$broker_entry" "$agent_entry"; do
  [ -f "$required_build" ] || blocked "required build artifact missing: $required_build"
done
[ -d "$server_dist" ] || blocked "server dist missing after build"

broker_unit_sha="$(sha256sum "$broker_unit" | awk '{print $1}')"
agent_unit_sha="$(sha256sum "$agent_unit" | awk '{print $1}')"
web_unit_sha="$(sha256sum "$web_unit" | awk '{print $1}')"
broker_entry_sha="$(sha256sum "$broker_entry" | awk '{print $1}')"
agent_entry_sha="$(sha256sum "$agent_entry" | awk '{print $1}')"
server_dist_sha="$(
  find "$server_dist" -type f -print0 \
    | sort -z \
    | xargs -0 sha256sum \
    | sha256sum \
    | awk '{print $1}'
)"

# 5. Immutable candidate generation + full verification.
node "$REPO/tools/production-candidate-manifest.mjs" \
  --root "$REPO" \
  --sha "$TARGET" \
  > "$MANIFEST" \
  || blocked "manifest generation failed"

node "$REPO/tools/production-candidate-manifest.mjs" \
  --root "$REPO" \
  --sha "$TARGET" \
  --verify "$MANIFEST" \
  | grep -q '"status":"PASS"' \
  || blocked "manifest verify failed"

candidate="$(jq -er '.candidateSha256' "$MANIFEST")"
files="$(jq -er '.fileCount' "$MANIFEST")"
bytes="$(jq -er '.totalBytes' "$MANIFEST")"
manifest_sha="$(sha256sum "$MANIFEST" | awk '{print $1}')"

for candidate_path in \
  ops/systemd/dashboard-rpi5-agent.service \
  ops/systemd/dashboard-rpi5-docker-broker.service \
  ops/systemd/dashboard-rpi5-web.service \
  apps/agent/dist/docker-broker-entry.js \
  apps/agent/dist/index.js; do
  count="$(jq -er --arg path "$candidate_path" '[.files[] | select(.path == $path)] | length' "$MANIFEST")"
  [ "$count" -eq 1 ] || blocked "candidate missing exact path: $candidate_path"
done

manifest_broker_unit_sha="$(jq -er --arg path 'ops/systemd/dashboard-rpi5-docker-broker.service' '.files[] | select(.path == $path) | .sha256' "$MANIFEST")"
manifest_agent_unit_sha="$(jq -er --arg path 'ops/systemd/dashboard-rpi5-agent.service' '.files[] | select(.path == $path) | .sha256' "$MANIFEST")"
manifest_web_unit_sha="$(jq -er --arg path 'ops/systemd/dashboard-rpi5-web.service' '.files[] | select(.path == $path) | .sha256' "$MANIFEST")"
manifest_broker_entry_sha="$(jq -er --arg path 'apps/agent/dist/docker-broker-entry.js' '.files[] | select(.path == $path) | .sha256' "$MANIFEST")"
manifest_agent_entry_sha="$(jq -er --arg path 'apps/agent/dist/index.js' '.files[] | select(.path == $path) | .sha256' "$MANIFEST")"

[ "$manifest_broker_unit_sha" = "$broker_unit_sha" ] || blocked "broker unit manifest hash mismatch"
[ "$manifest_agent_unit_sha" = "$agent_unit_sha" ] || blocked "agent unit manifest hash mismatch"
[ "$manifest_web_unit_sha" = "$web_unit_sha" ] || blocked "web unit manifest hash mismatch"
[ "$manifest_broker_entry_sha" = "$broker_entry_sha" ] || blocked "broker entry manifest hash mismatch"
[ "$manifest_agent_entry_sha" = "$agent_entry_sha" ] || blocked "agent entry manifest hash mismatch"

printf 'CANDIDATE_VERIFY_PASS sha256=%s files=%s bytes=%s manifest_sha256=%s broker_unit_sha256=%s agent_unit_sha256=%s web_unit_sha256=%s broker_entry_sha256=%s agent_entry_sha256=%s server_dist_sha256=%s\n' \
  "$candidate" "$files" "$bytes" "$manifest_sha" \
  "$manifest_broker_unit_sha" "$manifest_agent_unit_sha" "$manifest_web_unit_sha" \
  "$manifest_broker_entry_sha" "$manifest_agent_entry_sha" "$server_dist_sha"

# 6. Manifest-only runtime smoke in the operator workspace.
smoke="$(node "$REPO/tools/production-runtime-smoke.mjs" \
  --root "$REPO" \
  --manifest "$MANIFEST" \
  --sha "$TARGET")" \
  || blocked "runtime smoke failed"

[ "$(printf '%s' "$smoke" | jq -er '.status')" = PASS ] || blocked "smoke not PASS"
[ "$(printf '%s' "$smoke" | jq -er '.sourceSha')" = "$TARGET" ] || blocked "smoke source mismatch"
[ "$(printf '%s' "$smoke" | jq -er '.candidateSha256')" = "$candidate" ] || blocked "smoke candidate mismatch"
[ "$(printf '%s' "$smoke" | jq -er '.agent.healthStatus')" = 200 ] || blocked "smoke agent health mismatch"
[ "$(printf '%s' "$smoke" | jq -er '.agent.dockerStatus')" = 503 ] || blocked "isolated smoke agent Docker not fail-closed"
[ "$(printf '%s' "$smoke" | jq -er '.web.dockerStatus')" = 503 ] || blocked "isolated smoke web Docker not fail-closed"
[ "$(printf '%s' "$smoke" | jq -er '.terminal')" = disabled ] || blocked "terminal smoke mismatch"

printf 'RUNTIME_SMOKE_PASS candidate=%s isolated_docker=503 terminal=disabled\n' "$candidate"

# 7. Canonical release-controller PLAN only. No activation mode is invoked by this helper.
plan="$(cd "$REPO" && sudo /usr/bin/node tools/production-release-controller.mjs \
  --candidate-root "$REPO" \
  --manifest "$MANIFEST" \
  --sha "$TARGET")" \
  || blocked "release PLAN failed"

[ "$(printf '%s' "$plan" | jq -er '.status')" = PLAN ] || blocked "plan status mismatch"
[ "$(printf '%s' "$plan" | jq -er '.action')" = activate ] || blocked "plan action mismatch"
[ "$(printf '%s' "$plan" | jq -er '.sourceSha')" = "$TARGET" ] || blocked "plan source mismatch"
[ "$(printf '%s' "$plan" | jq -er '.candidateSha256')" = "$candidate" ] || blocked "plan candidate mismatch"
[ "$(printf '%s' "$plan" | jq -er '.observedCurrent')" = "$EXPECTED_CURRENT" ] || blocked "plan current mismatch"
[ "$(printf '%s' "$plan" | jq -er '.targetRelease')" = absent ] || blocked "plan target not absent"
[ "$(printf '%s' "$plan" | jq -c '.operations')" = '["copy_manifest_allowlisted_release","write_verified_manifest_marker","atomic_current_symlink_swap"]' ] \
  || blocked "plan operations mismatch"

printf 'RELEASE_PLAN_PASS %s\n' "$plan"

# 8. Re-prove production and trust boundaries did not change during preparation.
[ "$(readlink "$PROD_ROOT/current")" = "releases/$EXPECTED_CURRENT" ] || blocked "current changed during prep"
[ ! -e "$TARGET_RELEASE" ] || blocked "target release appeared during prep"
[ ! -e "$LOCK_PATH" ] || blocked "release lock appeared during prep"
[ "$(systemctl show "$BROKER_SERVICE" -p MainPID --value)" = "$broker_pid" ] || blocked "broker PID changed"
[ "$(systemctl show "$AGENT_SERVICE" -p MainPID --value)" = "$agent_pid" ] || blocked "agent PID changed"
[ "$(systemctl show "$WEB_SERVICE" -p MainPID --value)" = "$web_pid" ] || blocked "web PID changed"
[ "$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)" = "$broker_restarts" ] || blocked "broker restart count changed"
[ "$(systemctl show "$AGENT_SERVICE" -p NRestarts --value)" = "$agent_restarts" ] || blocked "agent restart count changed"
[ "$(systemctl show "$WEB_SERVICE" -p NRestarts --value)" = "$web_restarts" ] || blocked "web restart count changed"
[ "$(sudo readlink -f "/proc/$broker_pid/cwd")" = "$CURRENT_RELEASE" ] || blocked "broker cwd changed"
[ "$(sudo readlink -f "/proc/$agent_pid/cwd")" = "$CURRENT_RELEASE" ] || blocked "agent cwd changed"
[ "$(sudo readlink -f "/proc/$web_pid/cwd")" = "$OLD_WEB_RELEASE_PATH" ] || blocked "web cwd changed"

post_broker="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/containers')" || blocked "post-prep broker probe failed"
[ "$(response_status "$post_broker")" = 200 ] || blocked "broker state changed during prep"
post_agent="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' GET 8 || true)"
[ "$(response_status "$post_agent")" = 504 ] || blocked "A53 agent Docker state changed during prep"
printf '%s' "$(response_body "$post_agent")" | jq -e '.error == "OPERATION_TIMEOUT"' >/dev/null \
  || blocked "post-prep A53 timeout body mismatch"
post_quick="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' GET 5 || true)"
[ "$(response_status "$post_quick")" = 404 ] || blocked "Quick Commands changed during prep"
post_events="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' GET 5 || true)"
[ "$(response_status "$post_events")" = 503 ] || blocked "Docker events changed during prep"
post_logs="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/logs?sourceId=docker%3Ahomeassistant&range=15m' GET 5 || true)"
[ "$(response_status "$post_logs")" = 503 ] || blocked "Docker logs changed during prep"
[ ! -S "$TERMINAL_SOCKET" ] || blocked "terminal runtime socket appeared during prep"

for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then
    blocked "agent persistent group changed during prep: $forbidden_group"
  fi
done
if id -nG "$BROKER_USER" | tr ' ' '\n' | grep -Eq '^(docker|video)$'; then
  blocked "broker persistent group changed during prep"
fi
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -Eq "^(docker|video|$BROKER_GROUP)$"; then
  blocked "web persistent group changed during prep"
fi

access_after="$(access_probe)" || blocked "post-prep Access probe failed"
printf '%s' "$access_after" | grep -q 'PHASE128_ACCESS_CODE:302' || blocked "post-prep Access expected 302"
printf '%s' "$access_after" | grep -qi '^www-authenticate:.*cloudflare-access' || blocked "post-prep Access marker missing"

printf 'PHASE128_POST136_PREPARATION_READY target=%s ci_run=%s attempt=%s run_id=%s candidate=%s files=%s bytes=%s current=%s broker_pid=%s agent_pid=%s web_pid=%s workspace=%s\n' \
  "$TARGET" "$run_number" "$run_attempt" "$run_id" "$candidate" "$files" "$bytes" \
  "$EXPECTED_CURRENT" "$broker_pid" "$agent_pid" "$web_pid" "$WORKSPACE"
printf 'PHASE128_POST136_STOP production_mutation=NO release_apply=NO systemd_mutation=NO identity_mutation=NO permission_mutation=NO main_agent_docker_group=NO main_agent_video_group=NO broker_restart=NO agent_restart=NO web_restart=NO cloudflare=UNCHANGED quick=404 events=503 docker_logs=503 terminal=absent\n'
