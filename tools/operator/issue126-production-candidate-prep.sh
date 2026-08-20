#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

TARGET="a39fc7a9873eedb58cfa49568f9b2e05483cf7c2"
TARGET_TREE="bd2fa68711b1cf4617088a18c524e3c60d427152"
SOURCE_PR="160"
SOURCE_PR_HEAD="a44e95b4b480e29b8d537130903869c00fc3ef0d"
SOURCE_CI_RUN_ID="32407296336"
SOURCE_CI_RUN_NUMBER="368"
EXPECTED_CURRENT="4295c23de5634dcb86b5fe9f57be92416eb9a75b"
EXPECTED_CURRENT_CANDIDATE="f08677aef82d0213422a171b51efd46fa7db57b29385fdd9c5d185f2c7b83eb0"
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
WORKSPACE="$HOME/.cache/dashboard-rpi5-candidate-prep/${TARGET}-issue126"
REPO="$WORKSPACE/repo"
MANIFEST="$WORKSPACE/production-candidate.json"

blocked() {
  echo "ISSUE126_CANDIDATE_PREP_BLOCKED stage=${stage:-unknown}: $*" >&2
  exit 1
}

trap 'rc=$?; if [ "$rc" -ne 0 ]; then echo "ISSUE126_CANDIDATE_PREP_EXIT=$rc PRODUCTION_MUTATION=NO RELEASE_APPLY=NO SYSTEMD_MUTATION=NO IDENTITY_MUTATION=NO PERMISSION_MUTATION=NO CLOUDFLARE_MUTATION=NO SERVICE_RESTART=NO ACTIONS_MUTATION=NO AUTO_RETRY=NO AUTO_CLEANUP=NO" >&2; fi' EXIT

need() { command -v "$1" >/dev/null 2>&1 || blocked "missing command: $1"; }
for c in curl jq git node npm sha256sum systemctl readlink stat id getent grep awk sed sudo tail tr find sort xargs cmp; do need "$c"; done
[ "$(id -u)" -ne 0 ] || blocked "run as normal operator, not root"
[ "$(node -p 'process.versions.node.split(".")[0]')" = 24 ] || blocked "Node major is not 24"

response_status() { printf '%s' "$1" | tail -n 1; }
response_body() { printf '%s' "$1" | sed '$d'; }
unix_response() {
  local user="$1" socket="$2" path="$3" method="${4:-GET}" timeout="${5:-12}"
  sudo -u "$user" curl -sS --max-time "$timeout" --unix-socket "$socket" -X "$method" \
    -H 'Accept: application/json' -w $'\n%{http_code}' "http://localhost$path"
}
proc_has_gid() {
  local pid="$1" gid="$2"
  sudo awk -v wanted="$gid" '/^Groups:/ { for (i=2; i<=NF; i++) if ($i == wanted) found=1 } END { exit(found ? 0 : 1) }' "/proc/$pid/status"
}
access_probe() {
  curl -sS --max-time 10 -D - -o /dev/null -w $'\nISSUE126_ACCESS_CODE:%{http_code}\n' https://dash.rozkalns.net/
}

printf 'ISSUE126_CANDIDATE_PREP_START target=%s current=%s workspace=%s\n' "$TARGET" "$EXPECTED_CURRENT" "$WORKSPACE"

stage="github-source-gate"
main_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/branches/main")" || blocked "GitHub main lookup failed"
main_sha="$(printf '%s' "$main_json" | jq -er '.commit.sha')"
main_tree="$(printf '%s' "$main_json" | jq -er '.commit.commit.tree.sha')"
main_verified="$(printf '%s' "$main_json" | jq -er '.commit.commit.verification.verified')"
[ "$main_sha" = "$TARGET" ] || blocked "main drift expected=$TARGET actual=$main_sha"
[ "$main_tree" = "$TARGET_TREE" ] || blocked "main tree drift expected=$TARGET_TREE actual=$main_tree"
[ "$main_verified" = true ] || blocked "main signature is not verified"

pr_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/pulls/$SOURCE_PR")" || blocked "PR160 lookup failed"
[ "$(printf '%s' "$pr_json" | jq -er '.state')" = closed ] || blocked "PR160 not closed"
[ "$(printf '%s' "$pr_json" | jq -er '.merged')" = true ] || blocked "PR160 not merged"
[ "$(printf '%s' "$pr_json" | jq -er '.head.sha')" = "$SOURCE_PR_HEAD" ] || blocked "PR160 head drift"
[ "$(printf '%s' "$pr_json" | jq -er '.merge_commit_sha')" = "$TARGET" ] || blocked "PR160 merge SHA drift"

head_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/commits/$SOURCE_PR_HEAD")" || blocked "PR160 head commit lookup failed"
[ "$(printf '%s' "$head_json" | jq -er '.commit.tree.sha')" = "$TARGET_TREE" ] || blocked "PR160 head tree differs from merged main tree"

run_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/actions/runs/$SOURCE_CI_RUN_ID")" || blocked "CI368 lookup failed"
[ "$(printf '%s' "$run_json" | jq -er '.name')" = CI ] || blocked "CI368 workflow name drift"
[ "$(printf '%s' "$run_json" | jq -er '.run_number')" = "$SOURCE_CI_RUN_NUMBER" ] || blocked "CI368 run number drift"
[ "$(printf '%s' "$run_json" | jq -er '.head_sha')" = "$SOURCE_PR_HEAD" ] || blocked "CI368 head drift"
[ "$(printf '%s' "$run_json" | jq -er '.status')" = completed ] || blocked "CI368 not completed"
[ "$(printf '%s' "$run_json" | jq -er '.conclusion')" = success ] || blocked "CI368 not successful"
jobs_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/actions/runs/$SOURCE_CI_RUN_ID/jobs?per_page=100")" || blocked "CI368 jobs lookup failed"
for job_name in "check" "terminal-native (x64)" "terminal-native (arm64)"; do
  count="$(printf '%s' "$jobs_json" | jq -er --arg name "$job_name" '[.jobs[] | select(.name == $name and .status == "completed" and .conclusion == "success")] | length')"
  [ "$count" -eq 1 ] || blocked "required CI368 job not success: $job_name count=$count"
done
printf 'ISSUE126_SOURCE_GATE_PASS main=%s tree=%s pr160=MERGED ci368=SUCCESS\n' "$TARGET" "$TARGET_TREE"

stage="production-readonly-preflight"
current="$(readlink "$PROD_ROOT/current")" || blocked "current pointer unreadable"
[ "$current" = "releases/$EXPECTED_CURRENT" ] || blocked "current pointer drift expected=releases/$EXPECTED_CURRENT actual=$current"
[ -d "$CURRENT_RELEASE" ] || blocked "current release missing"
[ ! -e "$TARGET_RELEASE" ] || blocked "target release already exists"
[ ! -e "$LOCK_PATH" ] || blocked "release-controller lock exists"
CURRENT_MANIFEST="$CURRENT_RELEASE/.dashboard-production-candidate.json"
[ -f "$CURRENT_MANIFEST" ] || blocked "current immutable manifest missing"
sudo /usr/bin/node "$CURRENT_RELEASE/tools/production-candidate-manifest.mjs" --root "$CURRENT_RELEASE" --sha "$EXPECTED_CURRENT" --verify "$CURRENT_MANIFEST" \
  | grep -q '"status":"PASS"' || blocked "current immutable manifest verification failed"
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
for pid in "$broker_pid" "$agent_pid" "$web_pid"; do [[ "$pid" =~ ^[1-9][0-9]*$ ]] || blocked "invalid service PID: $pid"; done
for n in "$broker_restarts" "$agent_restarts" "$web_restarts"; do [[ "$n" =~ ^[0-9]+$ ]] || blocked "invalid NRestarts: $n"; done
broker_cwd="$(sudo readlink -f "/proc/$broker_pid/cwd")" || blocked "broker cwd unreadable"
agent_cwd="$(sudo readlink -f "/proc/$agent_pid/cwd")" || blocked "agent cwd unreadable"
web_cwd="$(sudo readlink -f "/proc/$web_pid/cwd")" || blocked "web cwd unreadable"
[ "$broker_cwd" = "$CURRENT_RELEASE" ] || blocked "broker cwd drift: $broker_cwd"
[ "$agent_cwd" = "$CURRENT_RELEASE" ] || blocked "agent cwd drift: $agent_cwd"
[ "$web_cwd" = "$CURRENT_RELEASE" ] || blocked "web cwd drift: $web_cwd"

for unit in dashboard-rpi5-docker-broker.service dashboard-rpi5-agent.service dashboard-rpi5-web.service; do
  sudo cmp -s "$CURRENT_RELEASE/ops/systemd/$unit" "/etc/systemd/system/$unit" || blocked "installed unit drift: $unit"
done

[ -f "$QUICK_DROPIN" ] || blocked "Quick Commands production drop-in missing"
expected_quick_dropin="$(printf '[Service]\nEnvironment=DASHBOARD_RPI5_QUICK_COMMANDS=enabled\n')"
actual_quick_dropin="$(sudo cat "$QUICK_DROPIN")" || blocked "Quick Commands drop-in unreadable"
[ "$actual_quick_dropin" = "$expected_quick_dropin" ] || blocked "Quick Commands drop-in bytes drift"
[ "$(sudo stat -Lc '%U:%G:%a:%F' "$QUICK_DROPIN")" = 'root:root:644:regular file' ] || blocked "Quick Commands drop-in metadata drift"

broker_gid="$(getent group "$BROKER_GROUP" | awk -F: '{print $3}')"
docker_gid="$(getent group docker | awk -F: '{print $3}')"
video_gid="$(getent group video | awk -F: '{print $3}')"
for gid in "$broker_gid" "$docker_gid" "$video_gid"; do [[ "$gid" =~ ^[0-9]+$ ]] || blocked "required GID unavailable"; done
for forbidden_group in docker video "$BROKER_GROUP"; do
  if id -nG "$AGENT_USER" | tr ' ' '\n' | grep -qx "$forbidden_group"; then blocked "agent persistent group boundary violated: $forbidden_group"; fi
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

broker_health="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/health' GET 5)" || blocked "broker health probe failed"
[ "$(response_status "$broker_health")" = 200 ] || blocked "broker health not 200"
broker_docker="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" '/v1/docker/containers' GET 12)" || blocked "broker Docker probe failed"
[ "$(response_status "$broker_docker")" = 200 ] || blocked "broker Docker current-state not 200"
for p in '/v1/docker/logs/homeassistant/15m' '/v1/docker/logs/prometheus/24h'; do
  r="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" "$p" GET 5)" || blocked "broker log probe failed: $p"
  [ "$(response_status "$r")" = 200 ] || blocked "broker log route not 200: $p"
done
now_epoch="$(date +%s)"
since_epoch="$((now_epoch - 60))"
old_broker_events="$(unix_response "$BROKER_USER" "$BROKER_SOCKET" "/v1/docker/events/recent?since=$since_epoch&until=$now_epoch" GET 5 || true)"
[ "$(response_status "$old_broker_events")" = 404 ] || blocked "current broker unexpectedly exposes #126 route"

agent_health="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/health' GET 5)" || blocked "agent health probe failed"
[ "$(response_status "$agent_health")" = 200 ] || blocked "agent health not 200"
agent_host="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/host/summary' GET 5)" || blocked "agent host probe failed"
[ "$(response_status "$agent_host")" = 200 ] || blocked "agent host not 200"
agent_docker="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/containers' GET 12)" || blocked "agent Docker probe failed"
[ "$(response_status "$agent_docker")" = 200 ] || blocked "agent Docker not 200"
for source_id in 'docker%3Ahomeassistant' 'docker%3Aprometheus'; do
  logs_probe="$(unix_response "$WEB_USER" "$AGENT_SOCKET" "/v1/logs?sourceId=$source_id&range=15m" GET 5)" || blocked "agent logs probe failed"
  [ "$(response_status "$logs_probe")" = 200 ] || blocked "Docker logs not 200"
done
events_probe="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' GET 5 || true)"
[ "$(response_status "$events_probe")" = 503 ] || blocked "Docker events must remain 503 before #126 activation"
quick_catalog="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' GET 5)" || blocked "Quick Commands catalog probe failed"
[ "$(response_status "$quick_catalog")" = 200 ] || blocked "Quick Commands catalog not 200"
printf '%s' "$(response_body "$quick_catalog")" | jq -e '(.commands|length==4) and (([.commands[].id]|sort)==["host.disk-root","host.failed-units","host.kernel","host.uptime"])' >/dev/null || blocked "Quick Commands catalog drift"
[ ! -S "$TERMINAL_SOCKET" ] || blocked "terminal/PTTY runtime socket unexpectedly exists"
access_before="$(access_probe)" || blocked "Cloudflare Access probe failed"
printf '%s' "$access_before" | grep -q 'ISSUE126_ACCESS_CODE:302' || blocked "Access expected 302"
printf '%s' "$access_before" | grep -qi '^www-authenticate:.*cloudflare-access' || blocked "Cloudflare Access marker missing"
printf 'ISSUE126_PRODUCTION_PREFLIGHT_PASS current=%s broker_pid=%s broker_nrestarts=%s agent_pid=%s agent_nrestarts=%s web_pid=%s web_nrestarts=%s host=200 docker=200 logs=200 events=503 quick=200 terminal=absent access=302\n' \
  "$EXPECTED_CURRENT" "$broker_pid" "$broker_restarts" "$agent_pid" "$agent_restarts" "$web_pid" "$web_restarts"

stage="fresh-workspace"
mkdir -p "$HOME/.cache/dashboard-rpi5-candidate-prep"
[ ! -e "$WORKSPACE" ] || blocked "workspace exists; no auto-reuse/cleanup: $WORKSPACE"
mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" remote add origin "https://github.com/$REPO_SLUG.git"
git -C "$REPO" fetch -q --depth=1 origin "$TARGET"
git -C "$REPO" checkout -q --detach FETCH_HEAD
[ "$(git -C "$REPO" rev-parse HEAD)" = "$TARGET" ] || blocked "fetched source drift"
[ "$(git -C "$REPO" rev-parse 'HEAD^{tree}')" = "$TARGET_TREE" ] || blocked "fetched tree drift"

stage="source-contract"
protocol="$REPO/apps/agent/src/docker-broker-protocol.ts"
events="$REPO/apps/agent/src/docker-events.ts"
broker_events="$REPO/apps/agent/src/docker-broker-events.ts"
live_events="$REPO/apps/agent/src/docker-events-live.ts"
agent_index="$REPO/apps/agent/src/index.ts"
for f in "$protocol" "$events" "$broker_events" "$live_events" "$agent_index"; do [ -f "$f" ] || blocked "required source file missing: $f"; done
grep -qF 'export const DOCKER_BROKER_EVENTS_PATH = "/v1/docker/events/recent" as const;' "$protocol" || blocked "broker events route drift"
grep -qF 'export const DOCKER_BROKER_EVENTS_MAX_WINDOW_SECONDS = 60 * 60;' "$protocol" || blocked "broker events window drift"
grep -qF 'export const DOCKER_BROKER_EVENTS_MAX_ITEMS = 512;' "$protocol" || blocked "broker raw-item bound drift"
grep -qF 'export const DOCKER_EVENTS_LOOKBACK_SECONDS = 60 * 60;' "$events" || blocked "agent events lookback drift"
grep -qF 'export const DOCKER_EVENTS_MAX_ITEMS = 256;' "$events" || blocked "agent normalized-item bound drift"
grep -qF 'method: "GET"' "$broker_events" || blocked "broker Engine GET contract missing"
grep -qF 'return await broker.readEvents(since, until, signal);' "$live_events" || blocked "agent->broker events transport missing"
grep -qF 'dockerEventsReader: (signal) => readLiveRecentDockerEvents(signal),' "$agent_index" || blocked "agent live events wiring missing"
printf 'ISSUE126_SOURCE_CONTRACT_PASS window_seconds=3600 broker_max_items=512 agent_max_items=256 engine_method=GET\n'

stage="build-test"
( cd "$REPO" && npm ci --ignore-scripts && npm audit --audit-level=high && npm run check ) || blocked "validation/build failed"

stage="candidate-manifest"
node "$REPO/tools/production-candidate-manifest.mjs" --root "$REPO" --sha "$TARGET" > "$MANIFEST" || blocked "candidate manifest generation failed"
node "$REPO/tools/production-candidate-manifest.mjs" --root "$REPO" --sha "$TARGET" --verify "$MANIFEST" \
  | grep -q '"status":"PASS"' || blocked "candidate manifest verification failed"
candidate="$(jq -er '.candidateSha256' "$MANIFEST")"
files="$(jq -er '.fileCount' "$MANIFEST")"
bytes="$(jq -er '.totalBytes' "$MANIFEST")"
manifest_sha="$(sha256sum "$MANIFEST" | awk '{print $1}')"
for p in apps/agent/dist/docker-broker-entry.js apps/agent/dist/index.js apps/server/dist/index.js ops/systemd/dashboard-rpi5-agent.service ops/systemd/dashboard-rpi5-docker-broker.service ops/systemd/dashboard-rpi5-web.service; do
  [ "$(jq -er --arg path "$p" '[.files[]|select(.path==$path)]|length' "$MANIFEST")" -eq 1 ] || blocked "candidate missing exact path: $p"
done
broker_entry_sha="$(jq -er --arg path 'apps/agent/dist/docker-broker-entry.js' '.files[]|select(.path==$path)|.sha256' "$MANIFEST")"
agent_entry_sha="$(jq -er --arg path 'apps/agent/dist/index.js' '.files[]|select(.path==$path)|.sha256' "$MANIFEST")"
printf 'ISSUE126_CANDIDATE_VERIFY_PASS sha256=%s files=%s bytes=%s manifest_sha256=%s broker_entry_sha256=%s agent_entry_sha256=%s\n' \
  "$candidate" "$files" "$bytes" "$manifest_sha" "$broker_entry_sha" "$agent_entry_sha"

stage="runtime-smoke"
smoke="$(node "$REPO/tools/production-runtime-smoke.mjs" --root "$REPO" --manifest "$MANIFEST" --sha "$TARGET")" || blocked "runtime smoke failed"
[ "$(printf '%s' "$smoke" | jq -er '.status')" = PASS ] || blocked "runtime smoke not PASS"
[ "$(printf '%s' "$smoke" | jq -er '.sourceSha')" = "$TARGET" ] || blocked "runtime smoke source mismatch"
[ "$(printf '%s' "$smoke" | jq -er '.candidateSha256')" = "$candidate" ] || blocked "runtime smoke candidate mismatch"
[ "$(printf '%s' "$smoke" | jq -er '.terminal')" = disabled ] || blocked "runtime smoke terminal mismatch"
printf 'ISSUE126_RUNTIME_SMOKE_PASS candidate=%s terminal=disabled\n' "$candidate"

stage="release-plan"
plan="$(cd "$REPO" && sudo /usr/bin/node tools/production-release-controller.mjs --candidate-root "$REPO" --manifest "$MANIFEST" --sha "$TARGET")" || blocked "release-controller PLAN failed"
[ "$(printf '%s' "$plan" | jq -er '.status')" = PLAN ] || blocked "release PLAN status mismatch"
[ "$(printf '%s' "$plan" | jq -er '.action')" = activate ] || blocked "release PLAN action mismatch"
[ "$(printf '%s' "$plan" | jq -er '.sourceSha')" = "$TARGET" ] || blocked "release PLAN source mismatch"
[ "$(printf '%s' "$plan" | jq -er '.candidateSha256')" = "$candidate" ] || blocked "release PLAN candidate mismatch"
[ "$(printf '%s' "$plan" | jq -er '.observedCurrent')" = "$EXPECTED_CURRENT" ] || blocked "release PLAN current mismatch"
[ "$(printf '%s' "$plan" | jq -er '.targetRelease')" = absent ] || blocked "release PLAN target should be absent"
printf 'ISSUE126_RELEASE_PLAN_PASS %s\n' "$plan"

stage="post-prep-reproof"
[ "$(readlink "$PROD_ROOT/current")" = "releases/$EXPECTED_CURRENT" ] || blocked "current pointer changed during prep"
[ ! -e "$TARGET_RELEASE" ] || blocked "target release appeared during prep"
[ ! -e "$LOCK_PATH" ] || blocked "release-controller lock appeared during prep"
[ "$(systemctl show "$BROKER_SERVICE" -p MainPID --value)" = "$broker_pid" ] || blocked "broker PID changed during prep"
[ "$(systemctl show "$AGENT_SERVICE" -p MainPID --value)" = "$agent_pid" ] || blocked "agent PID changed during prep"
[ "$(systemctl show "$WEB_SERVICE" -p MainPID --value)" = "$web_pid" ] || blocked "web PID changed during prep"
[ "$(systemctl show "$BROKER_SERVICE" -p NRestarts --value)" = "$broker_restarts" ] || blocked "broker restart count changed"
[ "$(systemctl show "$AGENT_SERVICE" -p NRestarts --value)" = "$agent_restarts" ] || blocked "agent restart count changed"
[ "$(systemctl show "$WEB_SERVICE" -p NRestarts --value)" = "$web_restarts" ] || blocked "web restart count changed"
[ "$(sudo readlink -f "/proc/$broker_pid/cwd")" = "$CURRENT_RELEASE" ] || blocked "broker cwd changed"
[ "$(sudo readlink -f "/proc/$agent_pid/cwd")" = "$CURRENT_RELEASE" ] || blocked "agent cwd changed"
[ "$(sudo readlink -f "/proc/$web_pid/cwd")" = "$CURRENT_RELEASE" ] || blocked "web cwd changed"
post_events="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/docker/events/recent' GET 5 || true)"
[ "$(response_status "$post_events")" = 503 ] || blocked "Docker events changed during prep"
post_logs="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/logs?sourceId=docker%3Ahomeassistant&range=15m' GET 5)" || blocked "post-prep logs probe failed"
[ "$(response_status "$post_logs")" = 200 ] || blocked "Docker logs changed during prep"
post_quick="$(unix_response "$WEB_USER" "$AGENT_SOCKET" '/v1/quick-commands' GET 5)" || blocked "post-prep Quick Commands probe failed"
[ "$(response_status "$post_quick")" = 200 ] || blocked "Quick Commands changed during prep"
[ ! -S "$TERMINAL_SOCKET" ] || blocked "terminal/PTTY socket appeared during prep"
post_access="$(access_probe)" || blocked "post-prep Access probe failed"
printf '%s' "$post_access" | grep -q 'ISSUE126_ACCESS_CODE:302' || blocked "post-prep Access expected 302"
printf '%s' "$post_access" | grep -qi '^www-authenticate:.*cloudflare-access' || blocked "post-prep Access marker missing"

printf 'ISSUE126_CANDIDATE_PREPARATION_READY target=%s tree=%s candidate=%s files=%s bytes=%s current=%s broker_pid=%s agent_pid=%s web_pid=%s workspace=%s\n' \
  "$TARGET" "$TARGET_TREE" "$candidate" "$files" "$bytes" "$EXPECTED_CURRENT" "$broker_pid" "$agent_pid" "$web_pid" "$WORKSPACE"
printf 'ISSUE126_CANDIDATE_PREP_STOP production_mutation=NO release_apply=NO systemd_mutation=NO identity_mutation=NO permission_mutation=NO cloudflare=UNCHANGED actions_mutation=NO broker_restart=NO agent_restart=NO web_restart=NO logs=200 quick=200 events=503 terminal=absent auto_retry=NO auto_cleanup=NO\n'
