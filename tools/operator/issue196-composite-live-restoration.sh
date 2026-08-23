#!/usr/bin/env bash
set -Eeuo pipefail

MODE="preflight"
RUN_BACKUP="NO"
RECEIPT_SHA256=""
OWNER_ACK=""
MUTATION_STARTED="NO"

readonly DASHBOARD_REPO="rozkalnsandris/dashboard_RPi5"
readonly DASHBOARD_GIT="https://github.com/rozkalnsandris/dashboard_RPi5.git"
readonly DASHBOARD_API="https://api.github.com/repos/rozkalnsandris/dashboard_RPi5"
readonly PRODUCER_REPO="rozkalnsandris/RPi5_main"
readonly PRODUCER_GIT="https://github.com/rozkalnsandris/RPi5_main.git"
readonly PRODUCER_API="https://api.github.com/repos/rozkalnsandris/RPi5_main"

readonly FUNCTIONAL_BASE_SHA="fb8b6067ae12eacfbfc21d2c104602f7fa257c1f"
readonly FUNCTIONAL_BASE_TREE="ec859e2b1d5c74be47986305d126dacf75093e0e"
readonly PRODUCER_REVIEWED_SHA="dff7d6346140f8be98c2edb09a6663d80688e0d7"
readonly TRUSTED_BACKUP_SHA256="5ca85a777422f74b30c5db12831e389ffe0c986186044a1c1fc4b3c5feadbb76"
readonly CONTROLLER_ACK="I_AUTHORIZED_DASHBOARD_RPI5_PRODUCTION_RELEASE_ACTIVATION"
readonly OWNER_ACK_REQUIRED="AUTHORIZE_ISSUE196_COMPOSITE_LIVE_RESTORATION"

readonly WEB_BASE="http://127.0.0.1:8787"
readonly PUBLIC_DASHBOARD_URL="https://dash.rozkalns.net"
readonly CURRENT_LINK="/opt/dashboard_RPi5/current"
readonly WEB_ENV="/etc/dashboard-rpi5/web.env"
readonly AGENT_USER="dashboard-rpi5-agent"
readonly BROKER_SERVICE="dashboard-rpi5-docker-broker.service"
readonly AGENT_SERVICE="dashboard-rpi5-agent.service"
readonly WEB_SERVICE="dashboard-rpi5-web.service"
readonly EVIDENCE_SERVICE="rpi5-dashboard-evidence.service"
readonly EVIDENCE_TIMER="rpi5-dashboard-evidence.timer"
readonly EVIDENCE_ROOT="/var/lib/dashboard-rpi5/evidence"
readonly BACKUP_ENTRYPOINT="/usr/local/sbin/rpi5-backup"
readonly BACKUP_CORE="/usr/local/lib/rpi5-maintenance/rpi5-backup-v10-core"
readonly PRODUCER_HELPER="/usr/local/lib/rpi5-maintenance/dashboard-evidence.py"
readonly LOCK_HELPER="/usr/local/lib/rpi5-maintenance/rpi5-maintenance-locks.sh"
readonly PRODUCER_WRAPPER="/usr/local/sbin/rpi5-dashboard-evidence"

readonly -a ALLOWED_TARGET_DIFF=(
  "apps/agent/src/app.ts"
  "apps/agent/src/production-log-sources.test.ts"
  "apps/agent/src/production-log-sources.ts"
  "docs/ISSUE196_COMPOSITE_LIVE_RESTORATION.md"
  "docs/PHASE5B_UNIFIED_LOGS.md"
  "package.json"
  "tools/issue196-composite-live-restoration.test.mjs"
  "tools/operator/issue196-composite-live-restoration.sh"
  "tools/operator/issue196-composite-live-common.sh"
  "tools/operator/issue196-composite-live-transaction.sh"
  "tools/operator/issue196-composite-live-apply.sh"
)

readonly -A PRODUCER_BLOBS=(
  ["ops/bin/rpi5-backup"]="059ac81b6af5aebb56ebd92a03407a5c28847954"
  ["ops/bin/rpi5-backup-serialized"]="e6884b488b7aed584d816ab91ddc362d8bcdad2b"
  ["ops/bin/rpi5-dashboard-evidence"]="f611f3a7f037b59b18e8224edfc31f9d9e7e80cf"
  ["ops/lib/dashboard-evidence.py"]="da08d8bc8d01a6543fef0eb7bcecd52696523459"
  ["ops/lib/rpi5-maintenance-locks.sh"]="5bbd78fbe3d402becd310c835925233ce0301a12"
  ["ops/systemd/rpi5-dashboard-evidence.service"]="41e8317b22c91aafbfb4159b14c856f4ae9c8590"
  ["ops/systemd/rpi5-dashboard-evidence.timer"]="27c99feebcf33da55e21471837750e9e28155b67"
  ["ops/cron.d/rpi5-backup"]="8dde57f1a8bcc8561a9fb27df318a7d9d8367f70"
)

TARGET_SHA=""
PRODUCER_CURRENT_SHA=""
EXPECTED_CURRENT_SHA=""
PROMETHEUS_URL=""
PROMETHEUS_URL_SHA256=""
RUN_ROOT=""
DASHBOARD_CLONE=""
PRODUCER_CLONE=""
PRODUCER_STAGE=""
MANIFEST=""
RECEIPT=""

usage() {
  cat <<'EOF'
usage:
  issue196-composite-live-restoration.sh --preflight-only [--run-backup]
  issue196-composite-live-restoration.sh --apply --receipt-sha256 <64hex> --owner-ack AUTHORIZE_ISSUE196_COMPOSITE_LIVE_RESTORATION [--run-backup]

--preflight-only is read-only with respect to production state. It may write only
under the invoking user's cache to build and validate an exact candidate.

--run-backup binds one real backup execution into the receipt. It is OFF by default.
EOF
}

fail() {
  printf 'ERROR=%s\n' "$*" >&2
  return 1
}

on_error() {
  local rc="$?"
  trap - ERR
  if [[ "$MUTATION_STARTED" == "YES" ]]; then
    printf 'RESULT=STOP_AFTER_MUTATION_ERROR\n' >&2
    printf 'NO_RETRY_ROLLBACK_CLEANUP=YES\n' >&2
    printf 'MUTATION_STARTED=YES\n' >&2
  else
    printf 'RESULT=STOP_BEFORE_MUTATION\n' >&2
    printf 'MUTATION_STARTED=NO\n' >&2
  fi
  exit "$rc"
}
trap on_error ERR

while (($#)); do
  case "$1" in
    --preflight-only)
      MODE="preflight"
      shift
      ;;
    --apply)
      MODE="apply"
      shift
      ;;
    --run-backup)
      RUN_BACKUP="YES"
      shift
      ;;
    --receipt-sha256)
      [[ $# -ge 2 ]] || { usage >&2; exit 64; }
      RECEIPT_SHA256="$2"
      shift 2
      ;;
    --owner-ack)
      [[ $# -ge 2 ]] || { usage >&2; exit 64; }
      OWNER_ACK="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 64
      ;;
  esac
done

if [[ "$MODE" == "preflight" ]]; then
  [[ -z "$RECEIPT_SHA256" && -z "$OWNER_ACK" ]] || fail "preflight does not accept apply credentials"
else
  [[ "$RECEIPT_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail "apply requires exact receipt sha256"
  [[ "$OWNER_ACK" == "$OWNER_ACK_REQUIRED" ]] || fail "owner acknowledgement mismatch"
fi

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command missing: $1"
}

for command_name in curl git node npm sha256sum readlink stat systemctl id python3 docker; do
  require_command "$command_name"
done


readonly ISSUE196_OPERATOR_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=tools/operator/issue196-composite-live-common.sh
source "${ISSUE196_OPERATOR_DIR}/issue196-composite-live-common.sh"
# shellcheck source=tools/operator/issue196-composite-live-transaction.sh
source "${ISSUE196_OPERATOR_DIR}/issue196-composite-live-transaction.sh"
# shellcheck source=tools/operator/issue196-composite-live-apply.sh
source "${ISSUE196_OPERATOR_DIR}/issue196-composite-live-apply.sh"

run_preflight() {
  printf 'STAGE=ISSUE196_COMPOSITE_LIVE_PREFLIGHT\n'
  TARGET_SHA="$(github_branch_sha "$DASHBOARD_API")"
  PRODUCER_CURRENT_SHA="$(github_branch_sha "$PRODUCER_API")"
  configure_run_paths
  [[ ! -e "$RUN_ROOT" ]] || fail "preflight run directory already exists; preserve prior evidence"
  init_dashboard_candidate
  init_producer_source
  require_push_ci_success "$DASHBOARD_API" "$TARGET_SHA" "CI"
  require_push_ci_success "$PRODUCER_API" "$PRODUCER_CURRENT_SHA" "Validate"
  verify_preflight_baseline
  build_candidate
  write_receipt
  printf 'TARGET_SHA=%s\n' "$TARGET_SHA"
  printf 'PRODUCER_CURRENT_SHA=%s\n' "$PRODUCER_CURRENT_SHA"
  printf 'EXPECTED_CURRENT_SHA=%s\n' "$EXPECTED_CURRENT_SHA"
  printf 'RUN_BACKUP=%s\n' "$RUN_BACKUP"
  printf 'PROMETHEUS_TARGET=VALIDATED_REDACTED\n'
  printf 'PRODUCTION_MUTATION=NO\n'
  printf 'SYSTEMD_MUTATION=NO\n'
  printf 'IDENTITY_PERMISSION_MUTATION=NO\n'
  printf 'DOCKER_AUTHORITY_MUTATION=NO\n'
  printf 'CLOUDFLARE_MUTATION=NO\n'
  printf 'TERMINAL_ACTIVATION=NO\n'
  printf 'RESULT=PREFLIGHT_PASS\n'
}

run_apply() {
  printf 'STAGE=ISSUE196_COMPOSITE_LIVE_APPLY\n'
  TARGET_SHA="$(github_branch_sha "$DASHBOARD_API")"
  PRODUCER_CURRENT_SHA="$(github_branch_sha "$PRODUCER_API")"
  configure_run_paths
  [[ -d "$DASHBOARD_CLONE" && -d "$PRODUCER_CLONE" && -d "$PRODUCER_STAGE" && -f "$MANIFEST" ]] ||
    fail "reviewed preflight artifacts are missing"
  load_receipt

  [[ "$(github_branch_sha "$DASHBOARD_API")" == "$TARGET_SHA" ]] || fail "dashboard main drift before mutation"
  [[ "$(github_branch_sha "$PRODUCER_API")" == "$PRODUCER_CURRENT_SHA" ]] || fail "producer main drift before mutation"
  require_push_ci_success "$DASHBOARD_API" "$TARGET_SHA" "CI"
  require_push_ci_success "$PRODUCER_API" "$PRODUCER_CURRENT_SHA" "Validate"
  [[ "$(current_release_sha)" == "$EXPECTED_CURRENT_SHA" ]] || fail "production current drift before mutation"
  require_service_active "$BROKER_SERVICE"
  require_service_active "$AGENT_SERVICE"
  require_service_active "$WEB_SERVICE"
  require_agent_groups
  require_terminal_absent
  require_web_env_metadata
  require_backup_baseline
  require_public_access_boundary
  discover_prometheus_target
  [[ "$PROMETHEUS_URL_SHA256" == "$(receipt_value PROMETHEUS_URL_SHA256)" ]] ||
    fail "Prometheus target drift before mutation"
  run_release_controller_plan

  MUTATION_STARTED="YES"

  run_release_controller_apply

  sudo /usr/bin/systemctl restart "$BROKER_SERVICE"
  wait_web_200 "/api/current/docker" "broker trust chain"

  sudo /usr/bin/systemctl restart "$AGENT_SERVICE"
  wait_web_200 "/api/current/host" "agent host trust chain"
  wait_web_200 "/api/current/docker" "agent Docker trust chain"

  install_producer_source
  sudo /usr/bin/systemctl daemon-reload
  sudo /usr/bin/systemctl enable --now "$EVIDENCE_TIMER"
  sudo /usr/bin/systemctl start "$EVIDENCE_SERVICE"
  require_evidence_files

  update_prometheus_env_without_disclosure "$PROMETHEUS_URL_SHA256"
  sudo /usr/bin/systemctl restart "$WEB_SERVICE"
  wait_web_200 "/api/health" "web after env/release activation"

  if [[ "$RUN_BACKUP" == "YES" ]]; then
    sudo "$BACKUP_ENTRYPOINT"
  fi

  final_acceptance

  record_deploy_evidence
  wait_web_200 "/api/deployments" "deployment evidence"

  printf 'TARGET_SHA=%s\n' "$TARGET_SHA"
  printf 'PRODUCER_REVIEWED_SHA=%s\n' "$PRODUCER_REVIEWED_SHA"
  printf 'RUN_BACKUP=%s\n' "$RUN_BACKUP"
  printf 'PROMETHEUS_TARGET=VALIDATED_REDACTED\n'
  printf 'PRODUCTION_MUTATION=YES\n'
  printf 'SYSTEMD_MUTATION=YES:producer_timer_install_enable_start_and_service_restarts\n'
  printf 'IDENTITY_PERMISSION_MUTATION=NO\n'
  printf 'DOCKER_AUTHORITY_MUTATION=NO\n'
  printf 'CLOUDFLARE_MUTATION=NO\n'
  printf 'TERMINAL_ACTIVATION=NO\n'
  printf 'RESULT=ISSUE196_COMPOSITE_LIVE_PASS\n'
}

if [[ "$MODE" == "preflight" ]]; then
  run_preflight
else
  run_apply
fi
