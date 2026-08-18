#!/usr/bin/env bash
set -Eeuo pipefail

TARGET="7f42858ba2760d235ceab05788141cf18a9dff9d"
EXPECTED_CURRENT="73c51f3446395c51ea010831c4614777264fae3e"
REPO_SLUG="rozkalnsandris/dashboard_RPi5"
PROD_ROOT="/opt/dashboard_RPi5"
WORKSPACE="$HOME/.cache/dashboard-rpi5-candidate-prep/$TARGET"
REPO="$WORKSPACE/repo"
MANIFEST="$WORKSPACE/production-candidate.json"
CURRENT_RELEASE="$PROD_ROOT/releases/$EXPECTED_CURRENT"
TARGET_RELEASE="$PROD_ROOT/releases/$TARGET"

blocked() { echo "PHASE128_PREP_BLOCKED: $*" >&2; exit 1; }
trap 'rc=$?; if [ "$rc" -ne 0 ]; then echo "PHASE128_PREP_EXIT=$rc PRODUCTION_MUTATION=NO RELEASE_APPLY=NO SYSTEMD_MUTATION=NO IDENTITY_MUTATION=NO CLOUDFLARE_MUTATION=NO AUTO_RETRY=NO" >&2; fi' EXIT

need() { command -v "$1" >/dev/null 2>&1 || blocked "missing command: $1"; }
for c in curl jq git node npm sha256sum systemctl readlink stat id getent grep mktemp; do need "$c"; done
[ "$(id -u)" -ne 0 ] || blocked "run as normal operator, not root"
[ "$(node -p 'process.versions.node.split(".")[0]')" = 24 ] || blocked "Node major is not 24"

echo "PHASE128_PREP_START target=$TARGET expected_current=$EXPECTED_CURRENT"

# 1. Authoritative GitHub main + push->main CI.
main_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' "https://api.github.com/repos/$REPO_SLUG/branches/main")" || blocked "GitHub main lookup failed"
main_sha="$(printf '%s' "$main_json" | jq -er '.commit.sha')"
[ "$main_sha" = "$TARGET" ] || blocked "main drift expected=$TARGET actual=$main_sha"

runs_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' "https://api.github.com/repos/$REPO_SLUG/actions/runs?branch=main&event=push&per_page=100")" || blocked "Actions lookup failed"
run_json="$(printf '%s' "$runs_json" | jq -ec --arg sha "$TARGET" '[.workflow_runs[] | select(.name=="CI" and .event=="push" and .head_branch=="main" and .head_sha==$sha)] | sort_by(.run_number) | last // empty')" || blocked "CI parse failed"
[ -n "$run_json" ] || blocked "exact push CI not found"
run_id="$(printf '%s' "$run_json" | jq -er '.id')"
run_number="$(printf '%s' "$run_json" | jq -er '.run_number')"
[ "$(printf '%s' "$run_json" | jq -er '.status')" = completed ] || blocked "CI not completed"
[ "$(printf '%s' "$run_json" | jq -er '.conclusion')" = success ] || blocked "CI not successful"

jobs_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' "https://api.github.com/repos/$REPO_SLUG/actions/runs/$run_id/jobs?per_page=100")" || blocked "CI jobs lookup failed"
for job in "check" "terminal-native (x64)" "terminal-native (arm64)"; do
  count="$(printf '%s' "$jobs_json" | jq -er --arg n "$job" '[.jobs[] | select(.name==$n and .status=="completed" and .conclusion=="success")] | length')"
  [ "$count" -eq 1 ] || blocked "required job not success: $job"
done
echo "GITHUB_EXACT_MAIN_CI_PASS main=$TARGET ci_run=$run_number run_id=$run_id"

# 2. Read-only production preflight.
current="$(readlink "$PROD_ROOT/current")" || blocked "current pointer unreadable"
[ "$current" = "releases/$EXPECTED_CURRENT" ] || blocked "current expected=releases/$EXPECTED_CURRENT actual=$current"
[ -d "$CURRENT_RELEASE" ] || blocked "current release missing"
[ ! -e "$TARGET_RELEASE" ] || blocked "target release already exists"
[ ! -e "$PROD_ROOT/.dashboard-release-controller.lock" ] || blocked "release lock exists"

sudo /usr/bin/node "$CURRENT_RELEASE/tools/production-candidate-manifest.mjs" --root "$CURRENT_RELEASE" --sha "$EXPECTED_CURRENT" --verify "$CURRENT_RELEASE/.dashboard-production-candidate.json" | grep -q '"status":"PASS"' || blocked "current release manifest verify failed"

for svc in dashboard-rpi5-agent.service dashboard-rpi5-web.service; do
  [ "$(systemctl is-active "$svc")" = active ] || blocked "$svc not active"
  [ "$(systemctl is-enabled "$svc")" = enabled ] || blocked "$svc not enabled"
done
agent_pid="$(systemctl show dashboard-rpi5-agent.service -p MainPID --value)"
web_pid="$(systemctl show dashboard-rpi5-web.service -p MainPID --value)"
agent_cwd="$(sudo readlink -f "/proc/$agent_pid/cwd")" || blocked "agent cwd unreadable"
web_cwd="$(sudo readlink -f "/proc/$web_pid/cwd")" || blocked "web cwd unreadable"
[ "$agent_cwd" = "$CURRENT_RELEASE" ] || blocked "agent cwd drift: $agent_cwd"
[ "$web_cwd" = "$CURRENT_RELEASE" ] || blocked "web cwd drift: $web_cwd"

for forbidden in docker video; do
  for g in $(id -nG dashboard-rpi5-agent); do [ "$g" != "$forbidden" ] || blocked "main agent unexpectedly in $forbidden"; done
done
sock_meta="$(sudo stat -Lc '%U:%G:%a:%F' /var/run/docker.sock)" || blocked "Docker socket stat failed"
[ "$sock_meta" = 'root:docker:660:socket' ] || blocked "unexpected Docker socket metadata: $sock_meta"

getent passwd dashboard-rpi5-docker-broker >/dev/null && blocked "broker user already exists"
getent group dashboard-rpi5-docker-broker-client >/dev/null && blocked "broker client group already exists"
[ ! -e /etc/systemd/system/dashboard-rpi5-docker-broker.service ] || blocked "broker unit already installed"
[ ! -S /run/dashboard-rpi5-docker-broker/broker.sock ] || blocked "broker socket already exists"

unix_http() {
  sudo -u dashboard-rpi5-web curl -sS --max-time 5 --unix-socket /run/dashboard-rpi5/agent.sock -o /dev/null -w '%{http_code}' "http://localhost$1"
}
[ "$(unix_http /v1/health)" = 200 ] || blocked "agent health not 200"
[ "$(unix_http /v1/host/summary)" = 200 ] || blocked "host summary not 200"
[ "$(unix_http /v1/docker/containers)" = 503 ] || blocked "Docker must be 503 before broker activation"
[ "$(unix_http /v1/quick-commands)" = 404 ] || blocked "Quick Commands not 404"
[ ! -S /run/dashboard-rpi5-terminal.sock ] || blocked "terminal socket exists"

headers="$(mktemp)"
access_code="$(curl -sS --max-time 10 -D "$headers" -o /dev/null -w '%{http_code}' https://dash.rozkalns.net/)" || blocked "Access probe failed"
[ "$access_code" = 302 ] || blocked "Access expected 302 actual=$access_code"
grep -qi '^www-authenticate:.*cloudflare-access' "$headers" || blocked "Access marker missing"
rm -f "$headers"
echo "PRODUCTION_PREFLIGHT_PASS current=$EXPECTED_CURRENT agent_pid=$agent_pid web_pid=$web_pid host=200 docker=503 quick=404 terminal=absent access=302 docker_sock=$sock_meta"

# 3. User-owned candidate workspace only. Never reuse/clean automatically.
mkdir -p "$HOME/.cache/dashboard-rpi5-candidate-prep"
[ ! -e "$WORKSPACE" ] || blocked "workspace exists; no auto-reuse/cleanup: $WORKSPACE"
mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" remote add origin "https://github.com/$REPO_SLUG.git"
git -C "$REPO" fetch -q --depth=1 origin main
git -C "$REPO" checkout -q --detach FETCH_HEAD
[ "$(git -C "$REPO" rev-parse HEAD)" = "$TARGET" ] || blocked "fetched source drift"

broker_unit="$REPO/ops/systemd/dashboard-rpi5-docker-broker.service"
agent_unit="$REPO/ops/systemd/dashboard-rpi5-agent.service"
grep -qx 'User=dashboard-rpi5-docker-broker' "$broker_unit" || blocked "broker user contract mismatch"
grep -qx 'Group=dashboard-rpi5-docker-broker-client' "$broker_unit" || blocked "broker group contract mismatch"
grep -qx 'SupplementaryGroups=docker' "$broker_unit" || blocked "broker Docker group contract mismatch"
grep -qx 'RestrictAddressFamilies=AF_UNIX' "$broker_unit" || blocked "broker AF_UNIX contract missing"
grep -qx 'SupplementaryGroups=dashboard-rpi5-docker-broker-client' "$agent_unit" || blocked "agent broker-client contract mismatch"
grep -qx 'Environment=DASHBOARD_RPI5_QUICK_COMMANDS=disabled' "$agent_unit" || blocked "Quick Commands source contract mismatch"

echo "SOURCE_TRUST_BOUNDARY_PASS broker_unit_sha256=$(sha256sum "$broker_unit" | awk '{print $1}') agent_unit_sha256=$(sha256sum "$agent_unit" | awk '{print $1}')"

# 4. Deterministic validation/build.
(
  cd "$REPO"
  npm ci --ignore-scripts
  npm audit --audit-level=high
  npm run check
) || blocked "validation/build failed"
[ -f "$REPO/apps/agent/dist/docker-broker-entry.js" ] || blocked "broker entrypoint missing after build"

# 5. Exact immutable candidate + runtime smoke.
node "$REPO/tools/production-candidate-manifest.mjs" --root "$REPO" --sha "$TARGET" > "$MANIFEST" || blocked "manifest generation failed"
node "$REPO/tools/production-candidate-manifest.mjs" --root "$REPO" --sha "$TARGET" --verify "$MANIFEST" | grep -q '"status":"PASS"' || blocked "manifest verify failed"
candidate="$(jq -er '.candidateSha256' "$MANIFEST")"
files="$(jq -er '.fileCount' "$MANIFEST")"
bytes="$(jq -er '.totalBytes' "$MANIFEST")"
manifest_sha="$(sha256sum "$MANIFEST" | awk '{print $1}')"
for p in ops/systemd/dashboard-rpi5-agent.service ops/systemd/dashboard-rpi5-docker-broker.service apps/agent/dist/docker-broker-entry.js; do
  [ "$(jq -er --arg p "$p" '[.files[] | select(.path==$p)] | length' "$MANIFEST")" -eq 1 ] || blocked "candidate missing $p"
done
echo "CANDIDATE_VERIFY_PASS sha256=$candidate files=$files bytes=$bytes manifest_sha256=$manifest_sha"

smoke="$(node "$REPO/tools/production-runtime-smoke.mjs" --root "$REPO" --manifest "$MANIFEST" --sha "$TARGET")" || blocked "runtime smoke failed"
[ "$(printf '%s' "$smoke" | jq -er '.status')" = PASS ] || blocked "smoke not PASS"
[ "$(printf '%s' "$smoke" | jq -er '.candidateSha256')" = "$candidate" ] || blocked "smoke candidate mismatch"
[ "$(printf '%s' "$smoke" | jq -er '.agent.dockerStatus')" = 503 ] || blocked "agent Docker preactivation not 503"
[ "$(printf '%s' "$smoke" | jq -er '.web.dockerStatus')" = 503 ] || blocked "web Docker preactivation not 503"
[ "$(printf '%s' "$smoke" | jq -er '.terminal')" = disabled ] || blocked "terminal smoke mismatch"
echo "RUNTIME_SMOKE_PASS candidate=$candidate docker_pre_activation=503 terminal=disabled"

# 6. Canonical release-controller PLAN only. No --apply is present in this script.
plan="$(cd "$REPO" && sudo /usr/bin/node tools/production-release-controller.mjs --candidate-root "$REPO" --manifest "$MANIFEST" --sha "$TARGET")" || blocked "release PLAN failed"
[ "$(printf '%s' "$plan" | jq -er '.status')" = PLAN ] || blocked "plan status mismatch"
[ "$(printf '%s' "$plan" | jq -er '.action')" = activate ] || blocked "plan action mismatch"
[ "$(printf '%s' "$plan" | jq -er '.sourceSha')" = "$TARGET" ] || blocked "plan source mismatch"
[ "$(printf '%s' "$plan" | jq -er '.candidateSha256')" = "$candidate" ] || blocked "plan candidate mismatch"
[ "$(printf '%s' "$plan" | jq -er '.observedCurrent')" = "$EXPECTED_CURRENT" ] || blocked "plan current mismatch"
[ "$(printf '%s' "$plan" | jq -er '.targetRelease')" = absent ] || blocked "plan target not absent"
[ "$(printf '%s' "$plan" | jq -c '.operations')" = '["copy_manifest_allowlisted_release","write_verified_manifest_marker","atomic_current_symlink_swap"]' ] || blocked "plan operations mismatch"
echo "RELEASE_PLAN_PASS $plan"

# 7. Re-prove no production mutation.
[ "$(readlink "$PROD_ROOT/current")" = "releases/$EXPECTED_CURRENT" ] || blocked "current changed during prep"
[ ! -e "$TARGET_RELEASE" ] || blocked "target release appeared during prep"
[ ! -e "$PROD_ROOT/.dashboard-release-controller.lock" ] || blocked "release lock appeared"
[ "$(systemctl show dashboard-rpi5-agent.service -p MainPID --value)" = "$agent_pid" ] || blocked "agent PID changed"
[ "$(systemctl show dashboard-rpi5-web.service -p MainPID --value)" = "$web_pid" ] || blocked "web PID changed"
[ "$(unix_http /v1/docker/containers)" = 503 ] || blocked "Docker state changed during prep"
[ "$(unix_http /v1/quick-commands)" = 404 ] || blocked "Quick Commands changed during prep"
[ ! -S /run/dashboard-rpi5-docker-broker/broker.sock ] || blocked "broker socket appeared"
[ ! -S /run/dashboard-rpi5-terminal.sock ] || blocked "terminal socket appeared"

echo "PHASE128_PREPARATION_READY target=$TARGET ci_run=$run_number run_id=$run_id candidate=$candidate files=$files bytes=$bytes current=$EXPECTED_CURRENT agent_pid=$agent_pid web_pid=$web_pid"
echo "PHASE128_STOP production_mutation=NO release_apply=NO systemd_mutation=NO identity_mutation=NO docker_group_main_agent=NO cloudflare=UNCHANGED quick=404 terminal=absent"
