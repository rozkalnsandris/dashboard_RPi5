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

REPO_SLUG="rozkalnsandris/dashboard_RPi5"
PROD_ROOT="/opt/dashboard_RPi5"
CURRENT_RELEASE="$PROD_ROOT/releases/$EXPECTED_CURRENT"
TARGET_RELEASE="$PROD_ROOT/releases/$TARGET"
LOCK_PATH="$PROD_ROOT/.dashboard-release-controller.lock"

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
QUICK_DROPIN="/etc/systemd/system/dashboard-rpi5-agent.service.d/10-quick-commands.conf"

WORKSPACE_ROOT="$HOME/.cache/dashboard-rpi5-candidate-recovery"
WORKSPACE="$WORKSPACE_ROOT/${TARGET}-issue127-ci318-a2"
REPO="$WORKSPACE/repo"
MANIFEST="$WORKSPACE/production-candidate.json"

blocked() {
  echo "ISSUE127_RECOVERY_PREP_BLOCKED: $*" >&2
  exit 1
}

trap 'rc=$?; if [ "$rc" -ne 0 ]; then echo "ISSUE127_RECOVERY_PREP_EXIT=$rc PRODUCTION_MUTATION=NO RELEASE_APPLY=NO ACTIONS_RERUN=NO SYSTEMD_MUTATION=NO IDENTITY_MUTATION=NO PERMISSION_MUTATION=NO CLOUDFLARE_MUTATION=NO SERVICE_RESTART=NO AUTO_RETRY=NO AUTO_CLEANUP=NO OLD_WORKSPACE_REUSE=NO" >&2; fi' EXIT

need() {
  command -v "$1" >/dev/null 2>&1 || blocked "missing command: $1"
}

for command_name in curl jq git node npm sha256sum systemctl readlink stat id getent grep awk sed sudo tail tr find sort xargs; do
  need "$command_name"
done

[ "$(id -u)" -ne 0 ] || blocked "run as normal operator, not root"
[ "$(node -p 'process.versions.node.split(".")[0]')" = 24 ] || blocked "Node major is not 24"

printf 'ISSUE127_RECOVERY_PREP_START target=%s current=%s ci_run=%s attempt=%s run_id=%s workspace=%s\n' \
  "$TARGET" "$EXPECTED_CURRENT" "$EXPECTED_CI_RUN_NUMBER" "$EXPECTED_CI_RUN_ATTEMPT" "$EXPECTED_CI_RUN_ID" "$WORKSPACE"

response_status() {
  printf '%s' "$1" | tail -n 1
}

response_body() {
  printf '%s' "$1" | sed '$d'
}

unix_response() {
  local user="$1" socket="$2" path="$3" method="${4:-GET}" timeout="${5:-12}"
  sudo -u "$user" curl -sS --max-time "$timeout" \
    --unix-socket "$socket" \
    -X "$method" \
    -H 'Accept: application/json' \
    -w $'\n%{http_code}' \
    "http://localhost$path"
}

proc_has_gid() {
  local pid="$1" gid="$2"
  sudo awk -v wanted="$gid" '
    /^Groups:/ {
      for (i=2; i<=NF; i++) if ($i == wanted) found=1
    }
    END { exit(found ? 0 : 1) }
  ' "/proc/$pid/status"
}

access_probe() {
  curl -sS --max-time 10 -D - -o /dev/null \
    -w $'\nISSUE127_ACCESS_CODE:%{http_code}\n' \
    https://dash.rozkalns.net/
}

###############################################################################
# 1. Bind to recovered exact-main CI #318 attempt 2. No discovery ambiguity,
#    no Actions mutation, and no reuse of the failed #147 invocation.
###############################################################################

main_json="$(curl -fsSL \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/branches/main")" \
  || blocked "GitHub main lookup failed"
main_sha="$(printf '%s' "$main_json" | jq -er '.commit.sha')"
main_tree="$(printf '%s' "$main_json" | jq -er '.commit.commit.tree.sha')"
[ "$main_sha" = "$TARGET" ] || blocked "main drift expected=$TARGET actual=$main_sha"
[ "$main_tree" = "$EXPECTED_TREE" ] || blocked "main tree drift expected=$EXPECTED_TREE actual=$main_tree"

run_json="$(curl -fsSL \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/actions/runs/$EXPECTED_CI_RUN_ID")" \
  || blocked "recovered CI lookup failed"

[ "$(printf '%s' "$run_json" | jq -er '.id')" = "$EXPECTED_CI_RUN_ID" ] || blocked "CI run id drift"
[ "$(printf '%s' "$run_json" | jq -er '.run_number')" = "$EXPECTED_CI_RUN_NUMBER" ] || blocked "CI run number drift"
[ "$(printf '%s' "$run_json" | jq -er '.run_attempt')" = "$EXPECTED_CI_RUN_ATTEMPT" ] || blocked "CI run attempt drift"
[ "$(printf '%s' "$run_json" | jq -er '.name')" = CI ] || blocked "CI workflow name drift"
[ "$(printf '%s' "$run_json" | jq -er '.event')" = push ] || blocked "CI event drift"
[ "$(printf '%s' "$run_json" | jq -er '.head_branch')" = main ] || blocked "CI branch drift"
[ "$(printf '%s' "$run_json" | jq -er '.head_sha')" = "$TARGET" ] || blocked "CI source SHA drift"
[ "$(printf '%s' "$run_json" | jq -er '.status')" = completed ] || blocked "recovered CI not completed"
[ "$(printf '%s' "$run_json" | jq -er '.conclusion')" = success ] || blocked "recovered CI not successful"

jobs_json="$(curl -fsSL \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/actions/runs/$EXPECTED_CI_RUN_ID/jobs?filter=latest&per_page=100")" \
  || blocked "recovered CI jobs lookup failed"

check_count="$(printf '%s' "$jobs_json" | jq -er --argjson id "$EXPECTED_CHECK_JOB_ID" '
  [.jobs[] | select(.id == $id and .name == "check" and .status == "completed" and .conclusion == "success")] | length
')"
[ "$check_count" -eq 1 ] || blocked "recovered check job identity/success mismatch"

for step_name in "Install Chromium" "Responsive browser tests"; do
  step_count="$(printf '%s' "$jobs_json" | jq -er --argjson id "$EXPECTED_CHECK_JOB_ID" --arg step "$step_name" '
    [.jobs[] | select(.id == $id) | .steps[]? | select(.name == $step and .status == "completed" and .conclusion == "success")] | length
  ')"
  [ "$step_count" -eq 1 ] || blocked "recovered check step not success: $step_name"
done

for job_name in "terminal-native (x64)" "terminal-native (arm64)"; do
  count="$(printf '%s' "$jobs_json" | jq -er --arg name "$job_name" '
    [.jobs[] | select(.name == $name and .status == "completed" and .conclusion == "success")] | length
  ')"
  [ "$count" -eq 1 ] || blocked "required native CI job not success: $job_name count=$count"
done

printf 'ISSUE127_RECOVERED_CI_PASS main=%s tree=%s ci_run=%s attempt=%s run_id=%s check_job=%s chromium=success responsive=success\n' \
  "$TARGET" "$EXPECTED_TREE" "$EXPECTED_CI_RUN_NUMBER" "$EXPECTED_CI_RUN_ATTEMPT" "$EXPECTED_CI_RUN_ID" "$EXPECTED_CHECK_JOB_ID"

###############################################################################
# 2. Read-only production baseline proof. No production write follows.
###############################################################################

current="$(readlink "$PROD_ROOT/current")" || blocked "current pointer unreadable"
[ "$current" = "releases/$EXPECTED_CURRENT" ] || blocked "current pointer drift expected=releases/$EXPECTED_CURRENT actual=$current"
[ -d "$CURRENT_RELEASE" ] || blocked "current release missing"
[ ! -e "$TARGET_RELEASE" ] || blocked "target release already exists"
[ ! -e "$LOCK_PATH" ] || blocked "release-controller lock exists"

CURRENT_MANIFEST="$CURRENT_RELEASE/.dashboard-production-candidate.json"
[ -f "$CURRENT_MANIFEST" ] || blocked "current immutable manifest missing"
sudo /usr/bin/node "$CURRENT_RELEASE/tools/production-candidate-manifest.mjs" \
  --root "$CURRENT_RELEASE" \
  --sha "$EXPECTED_CURRENT" \
  --verify "$CURRENT_MANIFEST" \
  | grep -q '"status":"PASS"' \
  || blocked "current immutable manifest verification failed"
[ "$(sudo jq -er '.candidateSha256' "$CURRENT_MANIFEST")" = "$EXPECTED_CURRENT_CANDIDATE" ] || blocked "current candidate digest drift"

for service_name in "$BROKER_SERVICE" "$AGENT_SERVICE" "$WEB_SERVICE"; do
  [ "$(systemctl is-active "$service_name")" = active ] || blocked "$service_name not active"
  [ "$(systemctl is-enabled "$service_name")" = enabled ] || blocked "$service_name not enabled"
done

broker_pid="$(systemctl show "$BROKER_SERVICE" -p MainPID --value)"
agent_pid="$(systemctl show "$AGENT_SERVICE" -p MainPID --value)"
web_pid="$(systemctl show "$WEB_SERVICE" -p MainPID --value)"
broker_restarts="$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)"
agent_restarts="$(systemctl show "$AGENT_SERVICE" -p NRestarts --value)"
web_restarts="$(systemctl show "$WEB_SERVICE" -p NRestarts --value)"

for pid in "$broker_pid" "$agent_pid" "$web_pid"; do
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || blocked "invalid service PID: $pid"
done
[ "$broker_restarts" = 0 ] || blocked "broker NRestarts drift: $broker_restarts"
[ "$agent_restarts" = 0 ] || blocked "agent NRestarts drift: $agent_restarts"
[ "$web_restarts" = 0 ] || blocked "web NRestarts drift: $web_restarts"

broker_cwd="$(sudo readlink -f "/proc/$broker_pid/cwd")" || blocked "broker cwd unreadable"
agent_cwd="$(sudo readlink -f "/proc/$agent_pid/cwd")" || blocked "agent cwd unreadable"
web_cwd="$(sudo readlink -f "/proc/$web_pid/cwd")" || blocked "web cwd unreadable"
[ "$broker_cwd" = "$PROD_ROOT/releases/$EXPECTED_BROKER_RELEASE" ] || blocked "broker cwd drift: $broker_cwd"
[ "$agent_cwd" = "$CURRENT_RELEASE" ] || blocked "agent cwd drift: $agent_cwd"
[ "$web_cwd" = "$CURRENT_RELEASE" ] || blocked "web cwd drift: $web_cwd"

[ -f "$QUICK_DROPIN" ] || blocked "Quick Commands production drop-in missing"
expected_quick_dropin="$(printf '[Service]\nEnvironment=DASHBOARD_RPI5_QUICK_COMMANDS=enabled\n')"
actual_quick_dropin="$(sudo cat "$QUICK_DROPIN")" || blocked "Quick Commands drop-in unreadable"
[ "$actual_quick_dropin" = "$expected_quick_dropin" ] || blocked "Quick Commands drop-in bytes drift"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$QUICK_DROPIN")" = 'root:root:644:regular file' ] || blocked "Quick Commands drop-in metadata drift"
agent_env="$(systemctl show "$AGENT_SERVICE" -p Environment --value)"
printf '%s\n' "$agent_env" | grep -q 'DASHBOARD_RPI5_QUICK_COMMANDS=enabled' || blocked "Quick Commands effective environment not enabled"

broker_gid="$(getent group "$BROKER_GROUP" | awk -F: '{print $3}')"
docker_gid="$(getent group docker | awk -F: '{print $3}')"
video_gid="$(getent group video | awk -F: '{print $3}')"
for gid in "$broker_gid" "$docker_gid" "$video_gid"; do
  [[ "$gid" =~ ^[0-9]+$ ]] || blocked "required GID unavailable"
done

for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then
    blocked "agent persistent group boundary violated: $forbidden_group"
  fi
done
if id -nG "$WEB_USER" | tr ' ' '\n' | grep -Eq "^(docker|video|$BROKER_GROUP)$"; then blocked "web persistent group boundary violated"; fi
if id -nG "$BROKER_USER" | tr ' ' '\n' | grep -Eq '^(docker|video)$'; then blocked "broker persistent privilege group drift"; fi
proc_has_gid "$agent_pid" "$broker_gid" || blocked "agent runtime broker-client group missing"
if proc_has_gid "$agent_pid" "$docker_gid"; then blocked "agent runtime Docker group appeared"; fi
if proc_has_gid "$agent_pid" "$video_gid"; then blocked "agent runtime video group appeared"; fi
proc_has_gid "$broker_pid" "$docker_gid" || blocked "broker runtime Docker group missing"

[ "$(sudo stat -Lc '%U:%G:%a:%F' /var/run/docker.sock)" = 'root:docker:660:socket' ] || blocked "Docker socket metadata drift"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$BROKER_SOCKET")" = "$BROKER_USER:$BROKER_GROUP:660:socket" ] || blocked "broker socket metadata drift"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$AGENT_SOCKET")" = 'dashboard-rpi5-agent:dashboard-rpi5-agent-client:660:socket' ] || blocked "agent socket metadata drift"

broker_health="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/health')" || blocked "broker health probe failed"
[ "$(response_status "$broker_health")" = 200 ] || blocked "broker health not 200"
broker_docker="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/containers')" || blocked "broker Docker probe failed"
[ "$(response_status "$broker_docker")" = 200 ] || blocked "broker Docker current-state not 200"
for broker_log_path in '/v1/docker/logs/homeassistant/15m' '/v1/docker/logs/prometheus/24h'; do
  probe="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" "$broker_log_path" GET 5 || true)"
  [ "$(response_status "$probe")" = 404 ] || blocked "old broker unexpectedly exposes #127 route: $broker_log_path"
done

agent_health="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/health' GET 5)" || blocked "agent health probe failed"
[ "$(response_status "$agent_health")" = 200 ] || blocked "agent health not 200"
agent_host="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary' GET 5)" || blocked "agent host probe failed"
[ "$(response_status "$agent_host")" = 200 ] || blocked "agent host not 200"
agent_docker="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' GET 12)" || blocked "agent Docker probe failed"
[ "$(response_status "$agent_docker")" = 200 ] || blocked "agent Docker current-state not 200"
for source_id in 'docker%3Ahomeassistant' 'docker%3Aprometheus'; do
  logs_probe="$(unix_response "$WEB_USER" "$AGENT_SOCKET" "/v1/logs?sourceId=$source_id&range=15m" GET 5 || true)"
  [ "$(response_status "$logs_probe")" = 503 ] || blocked "Docker logs should remain 503 before #127 activation"
done
events_probe="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' GET 5 || true)"
[ "$(response_status "$events_probe")" = 503 ] || blocked "Docker events should remain 503 pending #126"
quick_catalog="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' GET 5)" || blocked "Quick Commands catalog probe failed"
[ "$(response_status "$quick_catalog")" = 200 ] || blocked "Quick Commands catalog not 200"
printf '%s' "$(response_body "$quick_catalog")" | jq -e '
  (.commands | type == "array") and (.commands | length == 4)
  and (([.commands[].id] | sort) == ["host.disk-root","host.failed-units","host.kernel","host.uptime"])
' >/dev/null || blocked "Quick Commands catalog drift"
[ ! -S "$TERMINAL_SOCKET" ] || blocked "terminal/PTTY runtime socket unexpectedly exists"

access_before="$(access_probe)" || blocked "Cloudflare Access probe failed"
printf '%s' "$access_before" | grep -q 'ISSUE127_ACCESS_CODE:302' || blocked "Access expected 302"
printf '%s' "$access_before" | grep -qi '^www-authenticate:.*cloudflare-access' || blocked "Cloudflare Access marker missing"

printf 'ISSUE127_RECOVERY_PRODUCTION_PREFLIGHT_PASS current=%s broker_pid=%s agent_pid=%s web_pid=%s host=200 docker=200 logs=503 events=503 quick=200 terminal=absent access=302\n' \
  "$EXPECTED_CURRENT" "$broker_pid" "$agent_pid" "$web_pid"

###############################################################################
# 3. New recovery workspace only. Never reference, clean, or reuse old #147 path.
###############################################################################

mkdir -p "$WORKSPACE_ROOT"
[ ! -e "$WORKSPACE" ] || blocked "recovery workspace exists; no auto-reuse/cleanup: $WORKSPACE"
mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" remote add origin "https://github.com/$REPO_SLUG.git"
git -C "$REPO" fetch -q --depth=1 origin main
git -C "$REPO" checkout -q --detach FETCH_HEAD
fetched_sha="$(git -C "$REPO" rev-parse HEAD)"
fetched_tree="$(git -C "$REPO" rev-parse 'HEAD^{tree}')"
[ "$fetched_sha" = "$TARGET" ] || blocked "fetched source drift expected=$TARGET actual=$fetched_sha"
[ "$fetched_tree" = "$EXPECTED_TREE" ] || blocked "fetched tree drift expected=$EXPECTED_TREE actual=$fetched_tree"

###############################################################################
# 4. Pin the merged #127 trust-boundary contract before build.
###############################################################################

protocol="$REPO/apps/agent/src/docker-broker-protocol.ts"
broker_server="$REPO/apps/agent/src/docker-broker-server.ts"
live_logs="$REPO/apps/agent/src/docker-logs-live.ts"
agent_unit="$REPO/ops/systemd/dashboard-rpi5-agent.service"
for required_file in "$protocol" "$broker_server" "$live_logs" "$agent_unit"; do
  [ -f "$required_file" ] || blocked "required source file missing: $required_file"
done

grep -qF 'export const DOCKER_BROKER_LOG_MAX_RESPONSE_BYTES = 512 * 1024;' "$protocol" || blocked "Docker log response-byte bound missing"
grep -qF 'export const DOCKER_BROKER_LOG_TAIL = 400;' "$protocol" || blocked "Docker log tail bound missing"
grep -qF 'export const DOCKER_BROKER_LOG_SOURCES = ["homeassistant", "prometheus"] as const;' "$protocol" || blocked "Docker log source allowlist drift"
grep -qF 'export const DOCKER_BROKER_LOG_RANGES = ["15m", "1h", "6h", "24h"] as const;' "$protocol" || blocked "Docker log range allowlist drift"
grep -qF 'homeassistant: "homeassistant"' "$broker_server" || blocked "Home Assistant server-side target mapping missing"
grep -qF 'prometheus: "prometheus"' "$broker_server" || blocked "Prometheus server-side target mapping missing"
grep -qF 'logs?stdout=true&stderr=true&since=${sinceSeconds}&timestamps=true&tail=${DOCKER_BROKER_LOG_TAIL}' "$broker_server" || blocked "broker-owned fixed Docker log query contract missing"
grep -qF '"docker:homeassistant": { brokerSource: "homeassistant", containerName: "homeassistant" }' "$live_logs" || blocked "live Home Assistant source mapping missing"
grep -qF '"docker:prometheus": { brokerSource: "prometheus", containerName: "prometheus" }' "$live_logs" || blocked "live Prometheus source mapping missing"
grep -qx 'Environment=DASHBOARD_RPI5_QUICK_COMMANDS=disabled' "$agent_unit" || blocked "base unit Quick Commands contract drift"
printf 'ISSUE127_RECOVERY_SOURCE_CONTRACT_PASS sources=2 ranges=4 tail=400 max_bytes=524288 quick_base_unit=disabled\n'

###############################################################################
# 5. Exact-main validation/build and immutable candidate preparation.
###############################################################################

(
  cd "$REPO"
  npm ci --ignore-scripts
  npm audit --audit-level=high
  npm run check
) || blocked "validation/build failed"

broker_entry="$REPO/apps/agent/dist/docker-broker-entry.js"
agent_entry="$REPO/apps/agent/dist/index.js"
server_dist="$REPO/apps/server/dist"
[ -f "$broker_entry" ] || blocked "broker build artifact missing"
[ -f "$agent_entry" ] || blocked "agent build artifact missing"
[ -d "$server_dist" ] || blocked "server dist missing after build"
broker_entry_sha="$(sha256sum "$broker_entry" | awk '{print $1}')"
agent_entry_sha="$(sha256sum "$agent_entry" | awk '{print $1}')"
server_dist_sha="$(find "$server_dist" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')"

node "$REPO/tools/production-candidate-manifest.mjs" --root "$REPO" --sha "$TARGET" > "$MANIFEST" || blocked "candidate manifest generation failed"
node "$REPO/tools/production-candidate-manifest.mjs" --root "$REPO" --sha "$TARGET" --verify "$MANIFEST" \
  | grep -q '"status":"PASS"' || blocked "candidate manifest verification failed"

candidate="$(jq -er '.candidateSha256' "$MANIFEST")"
files="$(jq -er '.fileCount' "$MANIFEST")"
bytes="$(jq -er '.totalBytes' "$MANIFEST")"
manifest_sha="$(sha256sum "$MANIFEST" | awk '{print $1}')"
for candidate_path in \
  apps/agent/dist/docker-broker-entry.js \
  apps/agent/dist/index.js \
  apps/server/dist/index.js \
  ops/systemd/dashboard-rpi5-agent.service \
  ops/systemd/dashboard-rpi5-docker-broker.service \
  ops/systemd/dashboard-rpi5-web.service; do
  count="$(jq -er --arg path "$candidate_path" '[.files[] | select(.path == $path)] | length' "$MANIFEST")"
  [ "$count" -eq 1 ] || blocked "candidate missing exact path: $candidate_path"
done
manifest_broker_entry_sha="$(jq -er --arg path 'apps/agent/dist/docker-broker-entry.js' '.files[] | select(.path == $path) | .sha256' "$MANIFEST")"
manifest_agent_entry_sha="$(jq -er --arg path 'apps/agent/dist/index.js' '.files[] | select(.path == $path) | .sha256' "$MANIFEST")"
[ "$manifest_broker_entry_sha" = "$broker_entry_sha" ] || blocked "broker entry manifest hash mismatch"
[ "$manifest_agent_entry_sha" = "$agent_entry_sha" ] || blocked "agent entry manifest hash mismatch"
printf 'ISSUE127_RECOVERY_CANDIDATE_VERIFY_PASS sha256=%s files=%s bytes=%s manifest_sha256=%s broker_entry_sha256=%s agent_entry_sha256=%s server_dist_sha256=%s\n' \
  "$candidate" "$files" "$bytes" "$manifest_sha" "$manifest_broker_entry_sha" "$manifest_agent_entry_sha" "$server_dist_sha"

smoke="$(node "$REPO/tools/production-runtime-smoke.mjs" --root "$REPO" --manifest "$MANIFEST" --sha "$TARGET")" || blocked "runtime smoke failed"
[ "$(printf '%s' "$smoke" | jq -er '.status')" = PASS ] || blocked "runtime smoke not PASS"
[ "$(printf '%s' "$smoke" | jq -er '.sourceSha')" = "$TARGET" ] || blocked "runtime smoke source mismatch"
[ "$(printf '%s' "$smoke" | jq -er '.candidateSha256')" = "$candidate" ] || blocked "runtime smoke candidate mismatch"
[ "$(printf '%s' "$smoke" | jq -er '.agent.healthStatus')" = 200 ] || blocked "runtime smoke agent health mismatch"
[ "$(printf '%s' "$smoke" | jq -er '.terminal')" = disabled ] || blocked "runtime smoke terminal mismatch"
printf 'ISSUE127_RECOVERY_RUNTIME_SMOKE_PASS candidate=%s terminal=disabled\n' "$candidate"

plan="$(cd "$REPO" && sudo /usr/bin/node tools/production-release-controller.mjs \
  --candidate-root "$REPO" --manifest "$MANIFEST" --sha "$TARGET")" || blocked "release-controller PLAN failed"
[ "$(printf '%s' "$plan" | jq -er '.status')" = PLAN ] || blocked "release PLAN status mismatch"
[ "$(printf '%s' "$plan" | jq -er '.action')" = activate ] || blocked "release PLAN action mismatch"
[ "$(printf '%s' "$plan" | jq -er '.sourceSha')" = "$TARGET" ] || blocked "release PLAN source mismatch"
[ "$(printf '%s' "$plan" | jq -er '.candidateSha256')" = "$candidate" ] || blocked "release PLAN candidate mismatch"
[ "$(printf '%s' "$plan" | jq -er '.observedCurrent')" = "$EXPECTED_CURRENT" ] || blocked "release PLAN current mismatch"
[ "$(printf '%s' "$plan" | jq -er '.targetRelease')" = absent ] || blocked "release PLAN target should be absent"
[ "$(printf '%s' "$plan" | jq -c '.operations')" = '["copy_manifest_allowlisted_release","write_verified_manifest_marker","atomic_current_symlink_swap"]' ] || blocked "release PLAN operations mismatch"
printf 'ISSUE127_RECOVERY_RELEASE_PLAN_PASS %s\n' "$plan"

###############################################################################
# 6. Re-prove no production/trust-boundary mutation happened during preparation.
###############################################################################

[ "$(readlink "$PROD_ROOT/current")" = "releases/$EXPECTED_CURRENT" ] || blocked "current pointer changed during recovery prep"
[ ! -e "$TARGET_RELEASE" ] || blocked "target release appeared during recovery prep"
[ ! -e "$LOCK_PATH" ] || blocked "release-controller lock appeared during recovery prep"
[ "$(systemctl show "$BROKER_SERVICE" -p MainPID --value)" = "$broker_pid" ] || blocked "broker PID changed during recovery prep"
[ "$(systemctl show "$AGENT_SERVICE" -p MainPID --value)" = "$agent_pid" ] || blocked "agent PID changed during recovery prep"
[ "$(systemctl show "$WEB_SERVICE" -p MainPID --value)" = "$web_pid" ] || blocked "web PID changed during recovery prep"
[ "$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)" = "$broker_restarts" ] || blocked "broker restart count changed"
[ "$(systemctl show "$AGENT_SERVICE" -p NRestarts --value)" = "$agent_restarts" ] || blocked "agent restart count changed"
[ "$(systemctl show "$WEB_SERVICE" -p NRestarts --value)" = "$web_restarts" ] || blocked "web restart count changed"
[ "$(sudo readlink -f "/proc/$broker_pid/cwd")" = "$PROD_ROOT/releases/$EXPECTED_BROKER_RELEASE" ] || blocked "broker cwd changed"
[ "$(sudo readlink -f "/proc/$agent_pid/cwd")" = "$CURRENT_RELEASE" ] || blocked "agent cwd changed"
[ "$(sudo readlink -f "/proc/$web_pid/cwd")" = "$CURRENT_RELEASE" ] || blocked "web cwd changed"

post_agent_docker="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' GET 12)" || blocked "post-prep Docker probe failed"
[ "$(response_status "$post_agent_docker")" = 200 ] || blocked "Docker current-state changed during recovery prep"
for source_id in 'docker%3Ahomeassistant' 'docker%3Aprometheus'; do
  post_logs="$(unix_response "$WEB_USER" "$AGENT_SOCKET" "/v1/logs?sourceId=$source_id&range=15m" GET 5 || true)"
  [ "$(response_status "$post_logs")" = 503 ] || blocked "Docker logs changed during recovery prep"
done
post_events="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' GET 5 || true)"
[ "$(response_status "$post_events")" = 503 ] || blocked "Docker events changed during recovery prep"
post_quick="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' GET 5)" || blocked "post-prep Quick Commands probe failed"
[ "$(response_status "$post_quick")" = 200 ] || blocked "Quick Commands changed during recovery prep"
[ ! -S "$TERMINAL_SOCKET" ] || blocked "terminal/PTTY socket appeared during recovery prep"
for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then
    blocked "agent persistent group changed during recovery prep: $forbidden_group"
  fi
done
post_access="$(access_probe)" || blocked "post-prep Access probe failed"
printf '%s' "$post_access" | grep -q 'ISSUE127_ACCESS_CODE:302' || blocked "post-prep Access expected 302"
printf '%s' "$post_access" | grep -qi '^www-authenticate:.*cloudflare-access' || blocked "post-prep Access marker missing"

printf 'ISSUE127_RECOVERY_CANDIDATE_PREPARATION_READY target=%s tree=%s ci_run=%s attempt=%s run_id=%s check_job=%s candidate=%s files=%s bytes=%s manifest_sha256=%s current=%s broker_pid=%s agent_pid=%s web_pid=%s workspace=%s\n' \
  "$TARGET" "$EXPECTED_TREE" "$EXPECTED_CI_RUN_NUMBER" "$EXPECTED_CI_RUN_ATTEMPT" "$EXPECTED_CI_RUN_ID" "$EXPECTED_CHECK_JOB_ID" \
  "$candidate" "$files" "$bytes" "$manifest_sha" "$EXPECTED_CURRENT" "$broker_pid" "$agent_pid" "$web_pid" "$WORKSPACE"
printf 'ISSUE127_RECOVERY_PREP_STOP production_mutation=NO release_apply=NO actions_rerun=NO systemd_mutation=NO identity_mutation=NO permission_mutation=NO main_agent_docker_group=NO main_agent_video_group=NO broker_restart=NO agent_restart=NO web_restart=NO cloudflare=UNCHANGED quick=200 events=503 docker_logs=503 terminal=absent old_workspace_reuse=NO auto_retry=NO auto_cleanup=NO\n'
