#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="https://github.com/rozkalnsandris/dashboard_RPi5.git"
TARGET_SHA="46c47fbd53e6933e2d8db86abdab30edea2badd0"
TARGET_TREE="4244c8b5105cad996c87c743b3ba90519a4d092a"
EXPECTED_CURRENT_SHA="a39fc7a9873eedb58cfa49568f9b2e05483cf7c2"
GATE_BASE_SHA="5bb54d108bcacf5c0c35f9d34a349929d1ca8029"
GATE_BASE_TREE="ceef7bcc20ace3333d84c9c3d8c5bb8f00b5f925"
PRODUCTION_ROOT="/opt/dashboard_RPi5"
CURRENT_LINK="${PRODUCTION_ROOT}/current"
BROKER_SERVICE="dashboard-rpi5-docker-broker.service"
AGENT_SERVICE="dashboard-rpi5-agent.service"
WEB_SERVICE="dashboard-rpi5-web.service"
BROKER_SOCKET="/run/dashboard-rpi5-docker-broker/broker.sock"
AGENT_SOCKET="/run/dashboard-rpi5/agent.sock"
TERMINAL_SOCKET="/run/dashboard-rpi5-terminal.sock"
CONTROLLER_ACK="I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ACTIVATION"
RUN_ROOT="${HOME}/.cache/dashboard-rpi5-operator/issue186-${TARGET_SHA}"
CANDIDATE_ROOT="${RUN_ROOT}/candidate"
MANIFEST="${RUN_ROOT}/candidate-manifest.json"
PLAN="${RUN_ROOT}/release-plan.json"
PREFLIGHT_RECEIPT="${RUN_ROOT}/PREFLIGHT_PASS.txt"
MODE="preflight"
OWNER_ACK=""
EXPECTED_RECEIPT_SHA256=""
GITHUB_MAIN_SHA=""
MUTATION_STARTED="NO"

log() { printf '%s\n' "$*"; }
fail() { printf 'BLOCKED: %s\n' "$*" >&2; exit 1; }

on_error() {
  local rc=$?
  if [[ "$MUTATION_STARTED" == "YES" ]]; then
    printf 'PRODUCTION_MUTATION_STARTED=YES\nRESULT=STOP_AFTER_MUTATION_ERROR\nNO_RETRY_ROLLBACK_CLEANUP=YES\n' >&2
  fi
  exit "$rc"
}
trap on_error ERR

usage() {
  cat <<'EOF'
Usage:
  issue186-exact-main-production-rollout.sh --preflight-only
  issue186-exact-main-production-rollout.sh --apply --receipt-sha256 <sha256> --ack AUTHORIZE_ISSUE186_EXACT_MAIN_PRODUCTION_ROLLOUT

Default behavior is preflight-only. Preflight writes only below $HOME/.cache and performs
read-only production/GitHub checks. Apply requires a prior immutable PASS receipt plus a
separate exact owner acknowledgement. Merge or a generic continuation command is not deploy
authorization.
EOF
}

while (($# > 0)); do
  case "$1" in
    --preflight-only) MODE="preflight"; shift ;;
    --apply) MODE="apply"; shift ;;
    --receipt-sha256)
      (($# >= 2)) || fail "missing --receipt-sha256 value"
      EXPECTED_RECEIPT_SHA256="$2"; shift 2 ;;
    --ack)
      (($# >= 2)) || fail "missing --ack value"
      OWNER_ACK="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

for cmd in git node npm curl systemctl readlink sha256sum id grep awk sort sleep sudo tr; do
  command -v "$cmd" >/dev/null || fail "required command missing: $cmd"
done
[[ "$(node -p 'process.versions.node.split(".")[0]')" == "24" ]] || fail "Node major must be 24"

current_release_sha() {
  local resolved
  resolved="$(readlink -f "$CURRENT_LINK")" || return 1
  [[ "$resolved" == "${PRODUCTION_ROOT}/releases/"* ]] || return 1
  basename "$resolved"
}

http_status_unix() {
  local socket="$1" path="$2"
  curl --silent --show-error --max-time 5 --output /dev/null --write-out '%{http_code}' \
    --unix-socket "$socket" "http://localhost${path}"
}

http_status_loopback() {
  local path="$1"
  curl --silent --show-error --max-time 5 --output /dev/null --write-out '%{http_code}' \
    "http://127.0.0.1:8787${path}"
}

verify_service_release() {
  local service="$1" sha="$2" pid cwd restarts_a restarts_b
  systemctl is-active --quiet "$service" || fail "service not active: ${service}"
  pid="$(systemctl show "$service" --property=MainPID --value)"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || fail "invalid MainPID for ${service}: ${pid}"
  if ! cwd="$(sudo /usr/bin/readlink -f "/proc/${pid}/cwd" 2>&1)"; then
    fail "unable to read ${service} cwd via read-only sudo: ${cwd:-no output}"
  fi
  [[ "$cwd" == "${PRODUCTION_ROOT}/releases/${sha}" ]] || fail "${service} cwd mismatch: ${cwd}"
  restarts_a="$(systemctl show "$service" --property=NRestarts --value)"
  sleep 1
  restarts_b="$(systemctl show "$service" --property=NRestarts --value)"
  [[ "$restarts_a" == "$restarts_b" ]] || fail "${service} NRestarts changed during evidence window"
}

verify_security_invariants() {
  local groups
  groups="$(id -nG dashboard-rpi5-agent)"
  if grep -Eq '(^|[[:space:]])(docker|video)([[:space:]]|$)' <<<"$groups"; then
    fail "dashboard-rpi5-agent gained forbidden docker/video group authority"
  fi
  [[ ! -S "$TERMINAL_SOCKET" ]] || fail "terminal socket unexpectedly present"
  if systemctl is-active --quiet dashboard-rpi5-terminal.socket; then
    fail "terminal socket unit unexpectedly active"
  fi
}

verify_live_acceptance() {
  local expected_sha="$1" status access_status headers
  [[ "$(current_release_sha)" == "$expected_sha" ]] || fail "current release is not ${expected_sha}"
  verify_service_release "$BROKER_SERVICE" "$expected_sha"
  verify_service_release "$AGENT_SERVICE" "$expected_sha"
  verify_service_release "$WEB_SERVICE" "$expected_sha"
  verify_security_invariants
  [[ -S "$BROKER_SOCKET" ]] || fail "broker socket missing"
  [[ -S "$AGENT_SOCKET" ]] || fail "agent socket missing"

  status="$(http_status_unix "$BROKER_SOCKET" "/v1/health")"
  [[ "$status" == "200" ]] || fail "broker health status ${status}"
  status="$(http_status_unix "$BROKER_SOCKET" "/v1/docker/containers")"
  [[ "$status" == "200" ]] || fail "broker Docker status ${status}"
  status="$(http_status_unix "$AGENT_SOCKET" "/v1/health")"
  [[ "$status" == "200" ]] || fail "agent health status ${status}"
  status="$(http_status_loopback "/api/health")"
  [[ "$status" == "200" ]] || fail "web health status ${status}"
  status="$(http_status_loopback "/api/current/docker")"
  [[ "$status" == "200" ]] || fail "web Docker status ${status}"

  access_status="$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' https://dash.rozkalns.net/)"
  [[ "$access_status" == "302" || "$access_status" == "403" ]] || fail "unexpected unauthenticated Access status ${access_status}"

  if [[ "$expected_sha" == "$TARGET_SHA" ]]; then
    headers="$(curl --silent --show-error --max-time 5 --dump-header - --output /dev/null http://127.0.0.1:8787/api/health | tr -d '\r')"
    grep -qi '^content-security-policy:' <<<"$headers" || fail "CSP header missing after target activation"
    grep -qi '^x-content-type-options: *nosniff$' <<<"$headers" || fail "nosniff header missing after target activation"
    grep -qi '^cache-control: *no-store$' <<<"$headers" || fail "API no-store header missing after target activation"
  fi
}

refresh_github_main() {
  GITHUB_MAIN_SHA="$(git ls-remote "$REPO_URL" refs/heads/main | awk '{print $1}')"
  [[ "$GITHUB_MAIN_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "unable to resolve GitHub main"
}

verify_gate_lineage_in_clone() {
  local gate_parent main_parent gate_actual gate_expected corrective_actual corrective_expected
  [[ "$(git -C "$CANDIDATE_ROOT" rev-parse "$TARGET_SHA^{tree}")" == "$TARGET_TREE" ]] || fail "target tree mismatch"
  [[ "$(git -C "$CANDIDATE_ROOT" rev-parse "$GATE_BASE_SHA^{tree}")" == "$GATE_BASE_TREE" ]] || fail "gate base tree mismatch"

  gate_parent="$(git -C "$CANDIDATE_ROOT" rev-parse "${GATE_BASE_SHA}^")"
  [[ "$gate_parent" == "$TARGET_SHA" ]] || fail "reviewed issue186 gate base is not a direct child of target"
  gate_actual="$(git -C "$CANDIDATE_ROOT" diff --name-only "$TARGET_SHA" "$GATE_BASE_SHA" | sort)"
  gate_expected="$(printf '%s\n' \
    'docs/ISSUE186_EXACT_MAIN_PRODUCTION_ROLLOUT.md' \
    'package.json' \
    'tools/issue186-exact-main-production-rollout.test.mjs' \
    'tools/operator/issue186-exact-main-production-rollout.sh' | sort)"
  [[ "$gate_actual" == "$gate_expected" ]] || fail "reviewed issue186 gate base contains unexpected files"
  [[ "$GITHUB_MAIN_SHA" == "$GATE_BASE_SHA" ]] && return 0

  main_parent="$(git -C "$CANDIDATE_ROOT" rev-parse "${GITHUB_MAIN_SHA}^")"
  [[ "$main_parent" == "$GATE_BASE_SHA" ]] || fail "GitHub main is not reviewed gate base or one direct issue186 corrective child"
  corrective_actual="$(git -C "$CANDIDATE_ROOT" diff --name-only "$GATE_BASE_SHA" "$GITHUB_MAIN_SHA" | sort)"
  corrective_expected="$(printf '%s\n' \
    'docs/ISSUE186_EXACT_MAIN_PRODUCTION_ROLLOUT.md' \
    'tools/issue186-exact-main-production-rollout.test.mjs' \
    'tools/operator/issue186-exact-main-production-rollout.sh' | sort)"
  [[ "$corrective_actual" == "$corrective_expected" ]] || fail "post-gate GitHub main contains changes outside reviewed issue186 corrective source"
}

build_candidate_once() {
  [[ ! -e "$RUN_ROOT" ]] || fail "preflight run directory already exists: ${RUN_ROOT}"
  mkdir -p -m 0700 "$CANDIDATE_ROOT"
  git -C "$CANDIDATE_ROOT" init --quiet
  git -C "$CANDIDATE_ROOT" remote add origin "$REPO_URL"
  git -C "$CANDIDATE_ROOT" fetch --quiet --depth=3 origin "$GITHUB_MAIN_SHA"
  git -C "$CANDIDATE_ROOT" fetch --quiet --depth=1 origin "$TARGET_SHA"
  verify_gate_lineage_in_clone
  git -c advice.detachedHead=false -C "$CANDIDATE_ROOT" checkout --quiet --detach "$TARGET_SHA"
  [[ "$(git -C "$CANDIDATE_ROOT" rev-parse HEAD)" == "$TARGET_SHA" ]] || fail "candidate SHA mismatch"
  [[ "$(git -C "$CANDIDATE_ROOT" rev-parse HEAD^{tree})" == "$TARGET_TREE" ]] || fail "candidate tree mismatch"

  npm --prefix "$CANDIDATE_ROOT" ci --ignore-scripts
  npm --prefix "$CANDIDATE_ROOT" rebuild node-pty --build-from-source
  npm --prefix "$CANDIDATE_ROOT" audit --audit-level=high
  npm --prefix "$CANDIDATE_ROOT" run check

  node "$CANDIDATE_ROOT/tools/production-candidate-manifest.mjs" --root "$CANDIDATE_ROOT" --sha "$TARGET_SHA" >"$MANIFEST"
  node "$CANDIDATE_ROOT/tools/production-candidate-manifest.mjs" --root "$CANDIDATE_ROOT" --sha "$TARGET_SHA" --verify "$MANIFEST"
  node "$CANDIDATE_ROOT/tools/production-runtime-smoke.mjs" --root "$CANDIDATE_ROOT" --manifest "$MANIFEST" --sha "$TARGET_SHA"
  node "$CANDIDATE_ROOT/tools/production-release-controller.mjs" --candidate-root "$CANDIDATE_ROOT" --manifest "$MANIFEST" --sha "$TARGET_SHA" >"$PLAN"
}

write_preflight_receipt() {
  local candidate_sha256 receipt_sha
  candidate_sha256="$(node -e 'const fs=require("fs");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(m.candidateSha256)' "$MANIFEST")"
  cat >"$PREFLIGHT_RECEIPT" <<EOF
ISSUE=186
TARGET_SHA=${TARGET_SHA}
TARGET_TREE=${TARGET_TREE}
GATE_MAIN_SHA=${GITHUB_MAIN_SHA}
EXPECTED_CURRENT_SHA=${EXPECTED_CURRENT_SHA}
CANDIDATE_SHA256=${candidate_sha256}
GITHUB_LINEAGE=PASS
LIVE_BASELINE=PASS
SOURCE_CHECK=PASS
CANDIDATE_MANIFEST=PASS
ISOLATED_RUNTIME_SMOKE=PASS
RELEASE_CONTROLLER_PLAN=PASS
PRODUCTION_MUTATION=NO
CLOUDFLARE_MUTATION=NO
SYSTEMD_MUTATION=NO
EOF
  chmod 0600 "$PREFLIGHT_RECEIPT"
  receipt_sha="$(sha256sum "$PREFLIGHT_RECEIPT" | awk '{print $1}')"
  log "PREFLIGHT_RESULT=PASS"
  log "TARGET_SHA=${TARGET_SHA}"
  log "GATE_MAIN_SHA=${GITHUB_MAIN_SHA}"
  log "PREFLIGHT_RECEIPT_SHA256=${receipt_sha}"
  log "RUN_ROOT=${RUN_ROOT}"
  log "PRODUCTION_MUTATION=NO"
  log "NEXT_GATE=EXPLICIT_OWNER_PRODUCTION_ROLLOUT_AUTHORIZATION_BOUND_TO_RECEIPT"
}

verify_existing_preflight() {
  local actual_receipt_sha receipt_gate_main
  [[ "$EXPECTED_RECEIPT_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail "--receipt-sha256 must be 64 lowercase hex characters"
  [[ -f "$PREFLIGHT_RECEIPT" && -f "$MANIFEST" && -f "$PLAN" ]] || fail "preflight evidence is incomplete"
  actual_receipt_sha="$(sha256sum "$PREFLIGHT_RECEIPT" | awk '{print $1}')"
  [[ "$actual_receipt_sha" == "$EXPECTED_RECEIPT_SHA256" ]] || fail "preflight receipt hash mismatch"
  grep -qx "TARGET_SHA=${TARGET_SHA}" "$PREFLIGHT_RECEIPT" || fail "preflight target mismatch"
  grep -qx "EXPECTED_CURRENT_SHA=${EXPECTED_CURRENT_SHA}" "$PREFLIGHT_RECEIPT" || fail "preflight baseline mismatch"
  grep -qx 'PRODUCTION_MUTATION=NO' "$PREFLIGHT_RECEIPT" || fail "preflight mutation marker invalid"
  receipt_gate_main="$(awk -F= '$1=="GATE_MAIN_SHA"{print $2}' "$PREFLIGHT_RECEIPT")"
  [[ "$GITHUB_MAIN_SHA" == "$receipt_gate_main" ]] || fail "GitHub main moved after preflight"
  [[ "$(git -C "$CANDIDATE_ROOT" rev-parse HEAD)" == "$TARGET_SHA" ]] || fail "candidate checkout drifted"
  [[ "$(git -C "$CANDIDATE_ROOT" rev-parse HEAD^{tree})" == "$TARGET_TREE" ]] || fail "candidate tree drifted"
  node "$CANDIDATE_ROOT/tools/production-candidate-manifest.mjs" --root "$CANDIDATE_ROOT" --sha "$TARGET_SHA" --verify "$MANIFEST"
  node "$CANDIDATE_ROOT/tools/production-runtime-smoke.mjs" --root "$CANDIDATE_ROOT" --manifest "$MANIFEST" --sha "$TARGET_SHA"
  node "$CANDIDATE_ROOT/tools/production-release-controller.mjs" --candidate-root "$CANDIDATE_ROOT" --manifest "$MANIFEST" --sha "$TARGET_SHA" >"${RUN_ROOT}/release-plan-prewrite.json"
}

wait_unix_200() {
  local socket="$1" path="$2" label="$3" status=""
  for _ in {1..30}; do
    if [[ -S "$socket" ]]; then
      status="$(http_status_unix "$socket" "$path" 2>/dev/null || true)"
      [[ "$status" == "200" ]] && return 0
    fi
    sleep 1
  done
  fail "${label} did not reach HTTP 200"
}

wait_web_200() {
  local status=""
  for _ in {1..30}; do
    status="$(http_status_loopback "/api/health" 2>/dev/null || true)"
    [[ "$status" == "200" ]] && return 0
    sleep 1
  done
  fail "web did not reach HTTP 200"
}

if [[ "$MODE" == "preflight" ]]; then
  log "STAGE=EXACT_GITHUB_TARGET"
  refresh_github_main
  log "GITHUB_MAIN_SHA=${GITHUB_MAIN_SHA}"
  log "STAGE=LIVE_PRODUCTION_READ_ONLY_BASELINE"
  verify_live_acceptance "$EXPECTED_CURRENT_SHA"
  log "STAGE=EXACT_CANDIDATE_BUILD_AND_VALIDATION"
  build_candidate_once
  log "STAGE=UNCHANGED_PRODUCTION_REPROOF"
  verify_live_acceptance "$EXPECTED_CURRENT_SHA"
  write_preflight_receipt
  exit 0
fi

[[ "$OWNER_ACK" == "AUTHORIZE_ISSUE186_EXACT_MAIN_PRODUCTION_ROLLOUT" ]] || fail "exact owner acknowledgement missing"
log "STAGE=APPLY_PREWRITE_REVALIDATION"
refresh_github_main
verify_existing_preflight
verify_live_acceptance "$EXPECTED_CURRENT_SHA"
[[ "$(current_release_sha)" == "$EXPECTED_CURRENT_SHA" ]] || fail "production current drift before mutation"
log "PREWRITE_REVALIDATION=PASS"

log "STAGE=PRODUCTION_MUTATION_BEGIN"
MUTATION_STARTED="YES"
log "PRODUCTION_MUTATION_STARTED=YES"
sudo /usr/bin/node "$CANDIDATE_ROOT/tools/production-release-controller.mjs" \
  --candidate-root "$CANDIDATE_ROOT" \
  --manifest "$MANIFEST" \
  --sha "$TARGET_SHA" \
  --expected-current "$EXPECTED_CURRENT_SHA" \
  --apply \
  --ack "$CONTROLLER_ACK"
[[ "$(current_release_sha)" == "$TARGET_SHA" ]] || fail "release pointer did not activate exact target"

log "STAGE=RESTART_BROKER"
sudo systemctl restart "$BROKER_SERVICE"
wait_unix_200 "$BROKER_SOCKET" "/v1/health" "broker"
verify_service_release "$BROKER_SERVICE" "$TARGET_SHA"
[[ "$(http_status_unix "$BROKER_SOCKET" "/v1/docker/containers")" == "200" ]] || fail "broker Docker acceptance failed"

log "STAGE=RESTART_AGENT"
sudo systemctl restart "$AGENT_SERVICE"
wait_unix_200 "$AGENT_SOCKET" "/v1/health" "agent"
verify_service_release "$AGENT_SERVICE" "$TARGET_SHA"

log "STAGE=RESTART_WEB"
sudo systemctl restart "$WEB_SERVICE"
wait_web_200
verify_service_release "$WEB_SERVICE" "$TARGET_SHA"

log "STAGE=FINAL_ACCEPTANCE"
verify_live_acceptance "$TARGET_SHA"
log "RESULT=PASS"
log "PRODUCTION_RELEASE=${TARGET_SHA}"
log "CLOUDFLARE_MUTATION=NO"
log "SYSTEMD_UNIT_MUTATION=NO"
log "IDENTITY_PERMISSION_MUTATION=NO"
log "TERMINAL_ACTIVATION=NO"
