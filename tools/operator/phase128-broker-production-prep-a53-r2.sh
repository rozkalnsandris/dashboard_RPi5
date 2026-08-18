#!/usr/bin/env bash
set -Eeuo pipefail

TARGET="a53fb31c33d872ec4b434d5c999d5469e1989f14"
EXPECTED_CURRENT="73c51f3446395c51ea010831c4614777264fae3e"
REPO_SLUG="rozkalnsandris/dashboard_RPi5"
PROD_ROOT="/opt/dashboard_RPi5"
BROKER_USER="dashboard-rpi5-docker-broker"
BROKER_CLIENT_GROUP="dashboard-rpi5-docker-client"
OLD_INVALID_GROUP="dashboard-rpi5-docker-broker-client"
WORKSPACE="$HOME/.cache/dashboard-rpi5-candidate-prep/${TARGET}-r2"
REPO="$WORKSPACE/repo"
MANIFEST="$WORKSPACE/production-candidate.json"
CURRENT_RELEASE="$PROD_ROOT/releases/$EXPECTED_CURRENT"
TARGET_RELEASE="$PROD_ROOT/releases/$TARGET"
LOCK_PATH="$PROD_ROOT/.dashboard-release-controller.lock"

blocked() {
  echo "PHASE128_A53_R2_PREP_BLOCKED: $*" >&2
  exit 1
}

trap 'rc=$?; if [ "$rc" -ne 0 ]; then echo "PHASE128_A53_R2_PREP_EXIT=$rc PRODUCTION_MUTATION=NO RELEASE_APPLY=NO SYSTEMD_MUTATION=NO IDENTITY_MUTATION=NO CLOUDFLARE_MUTATION=NO AUTO_RETRY=NO AUTO_CLEANUP=NO" >&2; fi' EXIT

need() {
  command -v "$1" >/dev/null 2>&1 || blocked "missing command: $1"
}

for command_name in curl jq git node npm sha256sum systemctl readlink stat id getent grep mktemp awk; do
  need "$command_name"
done

[ "$(id -u)" -ne 0 ] || blocked "run as normal operator, not root"
[ "$(node -p 'process.versions.node.split(".")[0]')" = 24 ] || blocked "Node major is not 24"

assert_account_name_bound() {
  local value="$1"
  [ "${#value}" -le 32 ] || blocked "account token exceeds 32 characters: $value"
}

for account_token in \
  dashboard-rpi5-agent \
  dashboard-rpi5-agent-client \
  "$BROKER_USER" \
  "$BROKER_CLIENT_GROUP"; do
  assert_account_name_bound "$account_token"
done
[ "${#OLD_INVALID_GROUP}" -gt 32 ] || blocked "invalid-group regression fixture no longer exceeds 32 characters"

printf 'PHASE128_A53_R2_PREP_START target=%s expected_current=%s broker_client_group=%s workspace=%s\n' \
  "$TARGET" "$EXPECTED_CURRENT" "$BROKER_CLIENT_GROUP" "$WORKSPACE"

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
[ "$ci_status" = completed ] || blocked "CI not completed: status=$ci_status run=$run_number attempt=$run_attempt"
[ "$ci_conclusion" = success ] || blocked "CI not successful: conclusion=$ci_conclusion run=$run_number attempt=$run_attempt"

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

# 2. Fresh production read-only preflight.
current="$(readlink "$PROD_ROOT/current")" || blocked "current pointer unreadable"
[ "$current" = "releases/$EXPECTED_CURRENT" ] \
  || blocked "current expected=releases/$EXPECTED_CURRENT actual=$current"
[ -d "$CURRENT_RELEASE" ] || blocked "current release missing"
[ ! -e "$TARGET_RELEASE" ] || blocked "target release already exists"
[ ! -e "$LOCK_PATH" ] || blocked "release-controller lock exists"

sudo /usr/bin/node "$CURRENT_RELEASE/tools/production-candidate-manifest.mjs" \
  --root "$CURRENT_RELEASE" \
  --sha "$EXPECTED_CURRENT" \
  --verify "$CURRENT_RELEASE/.dashboard-production-candidate.json" \
  | grep -q '"status":"PASS"' \
  || blocked "current release manifest verify failed"

for service_name in dashboard-rpi5-agent.service dashboard-rpi5-web.service; do
  [ "$(systemctl is-active "$service_name")" = active ] || blocked "$service_name not active"
  [ "$(systemctl is-enabled "$service_name")" = enabled ] || blocked "$service_name not enabled"
done

agent_pid="$(systemctl show dashboard-rpi5-agent.service -p MainPID --value)"
web_pid="$(systemctl show dashboard-rpi5-web.service -p MainPID --value)"
[[ "$agent_pid" =~ ^[1-9][0-9]*$ ]] || blocked "invalid agent PID: $agent_pid"
[[ "$web_pid" =~ ^[1-9][0-9]*$ ]] || blocked "invalid web PID: $web_pid"
agent_cwd="$(sudo readlink -f "/proc/$agent_pid/cwd")" || blocked "agent cwd unreadable"
web_cwd="$(sudo readlink -f "/proc/$web_pid/cwd")" || blocked "web cwd unreadable"
[ "$agent_cwd" = "$CURRENT_RELEASE" ] || blocked "agent cwd drift: $agent_cwd"
[ "$web_cwd" = "$CURRENT_RELEASE" ] || blocked "web cwd drift: $web_cwd"

agent_groups="$(id -nG dashboard-rpi5-agent)"
for forbidden_group in docker video; do
  for group_name in $agent_groups; do
    [ "$group_name" != "$forbidden_group" ] || blocked "main agent unexpectedly in $forbidden_group"
  done
done

sock_meta="$(sudo stat -Lc '%U:%G:%a:%F' /var/run/docker.sock)" || blocked "Docker socket stat failed"
[ "$sock_meta" = 'root:docker:660:socket' ] || blocked "unexpected Docker socket metadata: $sock_meta"

getent passwd "$BROKER_USER" >/dev/null && blocked "broker user already exists before authorization"
getent group "$BROKER_CLIENT_GROUP" >/dev/null && blocked "broker client group already exists before authorization"
getent group "$OLD_INVALID_GROUP" >/dev/null && blocked "old invalid broker client group unexpectedly exists"
[ ! -e /etc/systemd/system/dashboard-rpi5-docker-broker.service ] || blocked "broker unit already installed"
[ ! -S /run/dashboard-rpi5-docker-broker/broker.sock ] || blocked "broker socket already exists"

unix_http() {
  sudo -u dashboard-rpi5-web \
    curl -sS --max-time 5 \
    --unix-socket /run/dashboard-rpi5/agent.sock \
    -o /dev/null -w '%{http_code}' \
    "http://localhost$1"
}

[ "$(unix_http /v1/health)" = 200 ] || blocked "agent health not 200"
[ "$(unix_http /v1/host/summary)" = 200 ] || blocked "host summary not 200"
[ "$(unix_http /v1/docker/containers)" = 503 ] || blocked "Docker must be 503 before broker activation"
[ "$(unix_http /v1/quick-commands)" = 404 ] || blocked "Quick Commands not 404"
[ ! -S /run/dashboard-rpi5-terminal.sock ] || blocked "terminal runtime socket exists"
[ ! -e /etc/systemd/system/dashboard-rpi5-terminal.socket ] || blocked "terminal socket unit exists"
[ ! -e /etc/systemd/system/dashboard-rpi5-terminal@.service ] || blocked "terminal service unit exists"

headers="$(mktemp)"
access_code="$(curl -sS --max-time 10 -D "$headers" -o /dev/null -w '%{http_code}' https://dash.rozkalns.net/)" \
  || blocked "Access probe failed"
[ "$access_code" = 302 ] || blocked "Access expected 302 actual=$access_code"
grep -qi '^www-authenticate:.*cloudflare-access' "$headers" || blocked "Access marker missing"
rm -f "$headers"

installed_agent_unit_sha="$(sudo sha256sum /etc/systemd/system/dashboard-rpi5-agent.service | awk '{print $1}')"
printf 'PRODUCTION_PREFLIGHT_PASS current=%s agent_pid=%s web_pid=%s host=200 docker=503 quick=404 terminal=absent access=302 docker_sock=%s installed_agent_unit_sha256=%s\n' \
  "$EXPECTED_CURRENT" "$agent_pid" "$web_pid" "$sock_meta" "$installed_agent_unit_sha"

# 3. Fresh operator-owned r2 workspace. Never reuse or clean an older prep workspace.
mkdir -p "$HOME/.cache/dashboard-rpi5-candidate-prep"
[ ! -e "$WORKSPACE" ] || blocked "r2 workspace exists; no auto-reuse/cleanup: $WORKSPACE"
mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" remote add origin "https://github.com/$REPO_SLUG.git"
git -C "$REPO" fetch -q --depth=1 origin main
git -C "$REPO" checkout -q --detach FETCH_HEAD
fetched_sha="$(git -C "$REPO" rev-parse HEAD)"
[ "$fetched_sha" = "$TARGET" ] || blocked "fetched source drift expected=$TARGET actual=$fetched_sha"

broker_unit="$REPO/ops/systemd/dashboard-rpi5-docker-broker.service"
agent_unit="$REPO/ops/systemd/dashboard-rpi5-agent.service"
systemd_test="$REPO/apps/agent/src/docker-broker-systemd.test.ts"
phase_doc="$REPO/docs/PHASE3C_DOCKER_BROKER.md"

for required_file in "$broker_unit" "$agent_unit" "$systemd_test" "$phase_doc"; do
  [ -f "$required_file" ] || blocked "required source file missing: $required_file"
done

grep -qx "User=$BROKER_USER" "$broker_unit" || blocked "broker user contract mismatch"
grep -qx "Group=$BROKER_CLIENT_GROUP" "$broker_unit" || blocked "broker primary group contract mismatch"
grep -qx 'SupplementaryGroups=docker' "$broker_unit" || blocked "broker Docker group contract mismatch"
grep -qx 'RestrictAddressFamilies=AF_UNIX' "$broker_unit" || blocked "broker AF_UNIX contract missing"
grep -qx "SupplementaryGroups=$BROKER_CLIENT_GROUP" "$agent_unit" || blocked "agent broker-client contract mismatch"
grep -qx 'Environment=DASHBOARD_RPI5_QUICK_COMMANDS=disabled' "$agent_unit" || blocked "Quick Commands source contract mismatch"

if grep -nF "$OLD_INVALID_GROUP" "$broker_unit" "$agent_unit" "$systemd_test" "$phase_doc" >/dev/null; then
  blocked "old invalid broker client group remains in reviewed trust-boundary source"
fi

grep -qF "$BROKER_CLIENT_GROUP" "$systemd_test" || blocked "systemd regression test missing new group"
grep -qF 'const LINUX_ACCOUNT_NAME_MAX = 32;' "$systemd_test" \
  || blocked "systemd account-name max constant missing"
grep -qF 'keeps deploy-time account names within the Linux/Debian bound' "$systemd_test" \
  || blocked "systemd account-name regression test case missing"
grep -qF 'toBeLessThanOrEqual(' "$systemd_test" \
  || blocked "systemd account-name upper-bound assertion missing"
grep -qF 'LINUX_ACCOUNT_NAME_MAX' "$systemd_test" \
  || blocked "systemd account-name bound constant not used"

broker_unit_sha="$(sha256sum "$broker_unit" | awk '{print $1}')"
agent_unit_sha="$(sha256sum "$agent_unit" | awk '{print $1}')"
printf 'SOURCE_TRUST_BOUNDARY_PASS broker_client_group=%s broker_unit_sha256=%s agent_unit_sha256=%s\n' \
  "$BROKER_CLIENT_GROUP" "$broker_unit_sha" "$agent_unit_sha"

# 4. Deterministic exact-main validation/build.
(
  cd "$REPO"
  npm ci --ignore-scripts
  npm audit --audit-level=high
  npm run check
) || blocked "validation/build failed"

broker_entry="$REPO/apps/agent/dist/docker-broker-entry.js"
[ -f "$broker_entry" ] || blocked "broker entrypoint missing after build"
broker_entry_sha="$(sha256sum "$broker_entry" | awk '{print $1}')"

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
  apps/agent/dist/docker-broker-entry.js; do
  count="$(jq -er --arg path "$candidate_path" '[.files[] | select(.path == $path)] | length' "$MANIFEST")"
  [ "$count" -eq 1 ] || blocked "candidate missing exact path: $candidate_path"
done

manifest_broker_unit_sha="$(jq -er --arg path 'ops/systemd/dashboard-rpi5-docker-broker.service' '.files[] | select(.path == $path) | .sha256' "$MANIFEST")"
manifest_agent_unit_sha="$(jq -er --arg path 'ops/systemd/dashboard-rpi5-agent.service' '.files[] | select(.path == $path) | .sha256' "$MANIFEST")"
manifest_broker_entry_sha="$(jq -er --arg path 'apps/agent/dist/docker-broker-entry.js' '.files[] | select(.path == $path) | .sha256' "$MANIFEST")"

[ "$manifest_broker_unit_sha" = "$broker_unit_sha" ] || blocked "broker unit manifest hash mismatch"
[ "$manifest_agent_unit_sha" = "$agent_unit_sha" ] || blocked "agent unit manifest hash mismatch"
[ "$manifest_broker_entry_sha" = "$broker_entry_sha" ] || blocked "broker entry manifest hash mismatch"

printf 'CANDIDATE_VERIFY_PASS sha256=%s files=%s bytes=%s manifest_sha256=%s broker_unit_sha256=%s agent_unit_sha256=%s broker_entry_sha256=%s\n' \
  "$candidate" "$files" "$bytes" "$manifest_sha" \
  "$manifest_broker_unit_sha" "$manifest_agent_unit_sha" "$manifest_broker_entry_sha"

# 6. Manifest-only runtime smoke. Broker intentionally remains absent.
smoke="$(node "$REPO/tools/production-runtime-smoke.mjs" \
  --root "$REPO" \
  --manifest "$MANIFEST" \
  --sha "$TARGET")" \
  || blocked "runtime smoke failed"

[ "$(printf '%s' "$smoke" | jq -er '.status')" = PASS ] || blocked "smoke not PASS"
[ "$(printf '%s' "$smoke" | jq -er '.sourceSha')" = "$TARGET" ] || blocked "smoke source mismatch"
[ "$(printf '%s' "$smoke" | jq -er '.candidateSha256')" = "$candidate" ] || blocked "smoke candidate mismatch"
[ "$(printf '%s' "$smoke" | jq -er '.agent.healthStatus')" = 200 ] || blocked "smoke agent health mismatch"
[ "$(printf '%s' "$smoke" | jq -er '.agent.dockerStatus')" = 503 ] || blocked "agent Docker preactivation not 503"
[ "$(printf '%s' "$smoke" | jq -er '.web.dockerStatus')" = 503 ] || blocked "web Docker preactivation not 503"
[ "$(printf '%s' "$smoke" | jq -er '.terminal')" = disabled ] || blocked "terminal smoke mismatch"

printf 'RUNTIME_SMOKE_PASS candidate=%s docker_pre_activation=503 terminal=disabled\n' "$candidate"

# 7. Canonical release-controller PLAN only. No --apply exists in this helper.
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

# 8. Re-prove no production/trust-boundary mutation.
[ "$(readlink "$PROD_ROOT/current")" = "releases/$EXPECTED_CURRENT" ] || blocked "current changed during prep"
[ ! -e "$TARGET_RELEASE" ] || blocked "target release appeared during prep"
[ ! -e "$LOCK_PATH" ] || blocked "release lock appeared during prep"
[ "$(systemctl show dashboard-rpi5-agent.service -p MainPID --value)" = "$agent_pid" ] || blocked "agent PID changed"
[ "$(systemctl show dashboard-rpi5-web.service -p MainPID --value)" = "$web_pid" ] || blocked "web PID changed"
[ "$(sudo readlink -f "/proc/$agent_pid/cwd")" = "$CURRENT_RELEASE" ] || blocked "agent cwd changed"
[ "$(sudo readlink -f "/proc/$web_pid/cwd")" = "$CURRENT_RELEASE" ] || blocked "web cwd changed"
[ "$(unix_http /v1/health)" = 200 ] || blocked "agent health changed during prep"
[ "$(unix_http /v1/host/summary)" = 200 ] || blocked "host summary changed during prep"
[ "$(unix_http /v1/docker/containers)" = 503 ] || blocked "Docker state changed during prep"
[ "$(unix_http /v1/quick-commands)" = 404 ] || blocked "Quick Commands changed during prep"
getent passwd "$BROKER_USER" >/dev/null && blocked "broker user appeared during prep"
getent group "$BROKER_CLIENT_GROUP" >/dev/null && blocked "broker client group appeared during prep"
[ ! -S /run/dashboard-rpi5-docker-broker/broker.sock ] || blocked "broker socket appeared during prep"
[ ! -S /run/dashboard-rpi5-terminal.sock ] || blocked "terminal socket appeared during prep"

post_headers="$(mktemp)"
post_access="$(curl -sS --max-time 10 -D "$post_headers" -o /dev/null -w '%{http_code}' https://dash.rozkalns.net/)" \
  || blocked "post-prep Access probe failed"
[ "$post_access" = 302 ] || blocked "post-prep Access expected 302 actual=$post_access"
grep -qi '^www-authenticate:.*cloudflare-access' "$post_headers" || blocked "post-prep Access marker missing"
rm -f "$post_headers"

printf 'PHASE128_A53_R2_PREPARATION_READY target=%s ci_run=%s attempt=%s run_id=%s candidate=%s files=%s bytes=%s current=%s agent_pid=%s web_pid=%s broker_client_group=%s workspace=%s\n' \
  "$TARGET" "$run_number" "$run_attempt" "$run_id" "$candidate" "$files" "$bytes" \
  "$EXPECTED_CURRENT" "$agent_pid" "$web_pid" "$BROKER_CLIENT_GROUP" "$WORKSPACE"
printf 'PHASE128_A53_R2_STOP production_mutation=NO release_apply=NO systemd_mutation=NO identity_mutation=NO docker_group_main_agent=NO cloudflare=UNCHANGED quick=404 terminal=absent\n'
