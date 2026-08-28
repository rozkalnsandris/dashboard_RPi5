#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

usage() {
  printf 'usage: %s --sha <40-lowercase-hex> --candidate-root <path> --manifest <path>\n' "${0##*/}" >&2
}

blocked() {
  local reason="${1:-unknown}"
  printf 'RESULT=BLOCKED\n'
  printf 'BLOCKED_REASON=%s\n' "$reason"
  printf 'PRODUCTION_MUTATION=NO\n'
  printf 'SYSTEMD_MUTATION=NO\n'
  printf 'IDENTITY_PERMISSION_MUTATION=NO\n'
  printf 'DOCKER_AUTHORITY_MUTATION=NO\n'
  printf 'CLOUDFLARE_MUTATION=NO\n'
  printf 'TERMINAL_ACTIVATION=NO\n'
  exit 1
}

SOURCE_SHA=''
CANDIDATE_ROOT=''
MANIFEST=''

while (($# > 0)); do
  case "$1" in
    --sha)
      (($# >= 2)) || { usage; exit 64; }
      SOURCE_SHA="$2"
      shift 2
      ;;
    --candidate-root)
      (($# >= 2)) || { usage; exit 64; }
      CANDIDATE_ROOT="$2"
      shift 2
      ;;
    --manifest)
      (($# >= 2)) || { usage; exit 64; }
      MANIFEST="$2"
      shift 2
      ;;
    *)
      usage
      exit 64
      ;;
  esac
done

[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || blocked 'invalid_source_sha'
[[ -n "$CANDIDATE_ROOT" ]] || blocked 'candidate_root_missing'
[[ -n "$MANIFEST" ]] || blocked 'manifest_missing'

for command_name in curl dirname getent grep id node readlink realpath sha256sum stat systemctl tr; do
  command -v "$command_name" >/dev/null 2>&1 || blocked "required_command_missing:${command_name}"
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(realpath -e "${SCRIPT_DIR}/../..")" || blocked 'repo_root_unavailable'
CANDIDATE_ROOT="$(realpath -e "$CANDIDATE_ROOT")" || blocked 'candidate_root_unavailable'
MANIFEST="$(realpath -e "$MANIFEST")" || blocked 'manifest_unavailable'
cd "$REPO_ROOT"

PRODUCTION_ROOT='/opt/dashboard_RPi5'
CURRENT_LINK="${PRODUCTION_ROOT}/current"
RELEASES_ROOT="${PRODUCTION_ROOT}/releases"
RELEASE_LOCK="${PRODUCTION_ROOT}/.dashboard-release-controller.lock"
BROKER_SOCKET='/run/dashboard-rpi5-log-broker/broker.sock'
BACKUP_LOG='/var/log/rpi5-backup.log'
QUICK_COMMANDS_DROPIN='/etc/systemd/system/dashboard-rpi5-agent.service.d/10-quick-commands.conf'
LOG_BROKER_UNIT='/etc/systemd/system/dashboard-rpi5-log-broker.service'
AGENT_UNIT='/etc/systemd/system/dashboard-rpi5-agent.service'
AGENT_USER='dashboard-rpi5-agent'
LOG_CLIENT_GROUP='dashboard-rpi5-log-client'
WEB_BASE='http://127.0.0.1:8787'

sha256_path() {
  local path="$1"
  local digest rest
  read -r digest rest < <(sha256sum "$path") || return 1
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$digest"
}

systemctl_value() {
  local unit="$1"
  local property="$2"
  systemctl show "$unit" --property="$property" --value 2>/dev/null
}

print_service() {
  local label="$1"
  local unit="$2"
  local load active sub pid restarts result cwd state

  load="$(systemctl_value "$unit" LoadState)" || blocked "${label,,}_load_state_unavailable"
  active="$(systemctl_value "$unit" ActiveState)" || blocked "${label,,}_active_state_unavailable"
  sub="$(systemctl_value "$unit" SubState)" || blocked "${label,,}_sub_state_unavailable"
  pid="$(systemctl_value "$unit" MainPID)" || blocked "${label,,}_pid_unavailable"
  restarts="$(systemctl_value "$unit" NRestarts)" || blocked "${label,,}_restart_count_unavailable"
  result="$(systemctl_value "$unit" Result)" || blocked "${label,,}_result_unavailable"

  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || blocked "${label,,}_pid_invalid"
  cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
  [[ -n "$cwd" ]] || blocked "${label,,}_cwd_unavailable"

  state="${load}/${active}/${sub}"
  printf -v "${label}_STATE" '%s' "$state"
  printf -v "${label}_PID" '%s' "$pid"
  printf -v "${label}_CWD" '%s' "$cwd"
  printf -v "${label}_NRESTARTS" '%s' "$restarts"
  printf -v "${label}_RESULT" '%s' "$result"

  printf '%s_STATE=%s\n' "$label" "$state"
  printf '%s_PID=%s\n' "$label" "$pid"
  printf '%s_CWD=%s\n' "$label" "$cwd"
  printf '%s_NRESTARTS=%s\n' "$label" "$restarts"
  printf '%s_RESULT=%s\n' "$label" "$result"
}

print_socket_unit() {
  local label="$1"
  local unit="$2"
  local load active sub state
  load="$(systemctl_value "$unit" LoadState)" || blocked "${label,,}_load_state_unavailable"
  active="$(systemctl_value "$unit" ActiveState)" || blocked "${label,,}_active_state_unavailable"
  sub="$(systemctl_value "$unit" SubState)" || blocked "${label,,}_sub_state_unavailable"
  state="${load}/${active}/${sub}"
  printf -v "${label}_STATE" '%s' "$state"
  printf '%s_STATE=%s\n' "$label" "$state"
}

http_status() {
  local url="$1"
  local timeout_seconds="$2"
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --connect-timeout 2 --max-time "$timeout_seconds" "$url" 2>/dev/null || true
}

broker_http_status() {
  local path="$1"
  local timeout_seconds="$2"
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --connect-timeout 2 --max-time "$timeout_seconds" \
    --unix-socket "$BROKER_SOCKET" "http://localhost${path}" 2>/dev/null || true
}

printf 'STAGE=ISSUE226_READ_ONLY_RECOVERY_PREFLIGHT\n'
printf 'TARGET_SHA=%s\n' "$SOURCE_SHA"
printf 'CANDIDATE_ROOT=%s\n' "$CANDIDATE_ROOT"
printf 'MANIFEST=%s\n' "$MANIFEST"

current_target="$(readlink "$CURRENT_LINK" 2>/dev/null || true)"
[[ "$current_target" =~ ^releases/([0-9a-f]{40})$ ]] || blocked 'current_pointer_invalid'
CURRENT_RELEASE="${BASH_REMATCH[1]}"
printf 'CURRENT_SYMLINK=%s\n' "$current_target"
printf 'CURRENT_RELEASE=%s\n' "$CURRENT_RELEASE"

TARGET_RELEASE_PATH="${RELEASES_ROOT}/${SOURCE_SHA}"
if [[ -e "$TARGET_RELEASE_PATH" || -L "$TARGET_RELEASE_PATH" ]]; then
  blocked 'target_release_already_present'
fi
printf 'TARGET_RELEASE=ABSENT\n'

if [[ -e "$RELEASE_LOCK" || -L "$RELEASE_LOCK" ]]; then
  blocked 'release_controller_lock_present'
fi
printf 'RELEASE_CONTROLLER_LOCK=ABSENT\n'

getent group "$LOG_CLIENT_GROUP" >/dev/null 2>&1 || blocked 'log_client_group_missing'
printf 'LOG_CLIENT_GROUP=PRESENT\n'

agent_groups="$(id -nG "$AGENT_USER" 2>/dev/null || true)"
[[ -n "$agent_groups" ]] || blocked 'agent_groups_unavailable'
printf 'AGENT_GROUPS=%s\n' "$agent_groups"
if tr ' ' '\n' <<<"$agent_groups" | grep -Eq '^(docker|adm|systemd-journal|sudo|root)$'; then
  blocked 'agent_broad_privileged_group_present'
fi
printf 'AGENT_BROAD_PRIVILEGED_GROUPS=ABSENT\n'

print_service DOCKER_BROKER dashboard-rpi5-docker-broker.service
print_service AGENT dashboard-rpi5-agent.service
print_service WEB dashboard-rpi5-web.service
print_service LOG_BROKER dashboard-rpi5-log-broker.service
print_socket_unit TERMINAL_SOCKET dashboard-rpi5-terminal.socket

for label in DOCKER_BROKER AGENT WEB LOG_BROKER; do
  state_var="${label}_STATE"
  [[ "${!state_var}" == 'loaded/active/running' ]] || blocked "${label,,}_not_active_running"
done
[[ "$TERMINAL_SOCKET_STATE" == 'loaded/active/listening' ]] || blocked 'terminal_socket_not_listening'

broker_socket_metadata="$(stat -Lc '%U:%G:%a:%F' "$BROKER_SOCKET" 2>/dev/null || true)"
[[ "$broker_socket_metadata" == 'root:dashboard-rpi5-log-client:660:socket' ]] || blocked 'broker_socket_metadata_invalid'
printf 'LOG_BROKER_SOCKET=%s\n' "$broker_socket_metadata"

broker_health_status="$(broker_http_status '/v1/health' 5)"
[[ "$broker_health_status" == '200' ]] || blocked 'broker_health_failed'
printf 'LOG_BROKER_HEALTH_HTTP=%s\n' "$broker_health_status"

broker_ssh_status="$(broker_http_status '/v1/logs/systemd:ssh/15m' 5)"
[[ "$broker_ssh_status" == '200' ]] || blocked 'broker_systemd_ssh_read_failed'
printf 'LOG_BROKER_SYSTEMD_SSH_HTTP=%s\n' "$broker_ssh_status"
printf 'LOG_BROKER_SYSTEMD_SSH_BODY=DISCARDED\n'

agent_environment="$(systemctl_value dashboard-rpi5-agent.service Environment 2>/dev/null || true)"
[[ -n "$agent_environment" ]] || blocked 'agent_environment_unavailable'
grep -Eq '(^|[[:space:]])DASHBOARD_RPI5_QUICK_COMMANDS=enabled($|[[:space:]])' <<<"$agent_environment" \
  || blocked 'quick_commands_not_enabled'
printf 'QUICK_COMMANDS_EFFECTIVE=enabled\n'

[[ -f "$QUICK_COMMANDS_DROPIN" && ! -L "$QUICK_COMMANDS_DROPIN" ]] || blocked 'quick_commands_dropin_invalid'
qc_metadata="$(stat -Lc '%U:%G:%a:%F' "$QUICK_COMMANDS_DROPIN" 2>/dev/null || true)"
qc_sha="$(sha256_path "$QUICK_COMMANDS_DROPIN" 2>/dev/null || true)"
[[ "$qc_sha" =~ ^[0-9a-f]{64}$ ]] || blocked 'quick_commands_dropin_digest_unavailable'
printf 'QUICK_COMMANDS_DROPIN_METADATA=%s\n' "$qc_metadata"
printf 'QUICK_COMMANDS_DROPIN_SHA256=%s\n' "$qc_sha"

backup_metadata="$(stat -Lc '%U:%G:%a:%F' "$BACKUP_LOG" 2>/dev/null || true)"
[[ "$backup_metadata" == 'root:root:600:regular file' ]] || blocked 'backup_log_metadata_invalid'
printf 'BACKUP_LOG_METADATA=%s\n' "$backup_metadata"

for unit_path in "$LOG_BROKER_UNIT" "$AGENT_UNIT"; do
  [[ -f "$unit_path" && ! -L "$unit_path" ]] || blocked "installed_unit_invalid:${unit_path##*/}"
done
installed_log_broker_sha="$(sha256_path "$LOG_BROKER_UNIT" 2>/dev/null || true)"
installed_agent_sha="$(sha256_path "$AGENT_UNIT" 2>/dev/null || true)"
[[ "$installed_log_broker_sha" =~ ^[0-9a-f]{64}$ ]] || blocked 'installed_log_broker_unit_digest_unavailable'
[[ "$installed_agent_sha" =~ ^[0-9a-f]{64}$ ]] || blocked 'installed_agent_unit_digest_unavailable'
printf 'INSTALLED_LOG_BROKER_UNIT_SHA256=%s\n' "$installed_log_broker_sha"
printf 'INSTALLED_AGENT_UNIT_SHA256=%s\n' "$installed_agent_sha"

candidate_log_unit="${CANDIDATE_ROOT}/ops/systemd/dashboard-rpi5-log-broker.service"
candidate_agent_unit="${CANDIDATE_ROOT}/ops/systemd/dashboard-rpi5-agent.service"
candidate_broker_entry="${CANDIDATE_ROOT}/apps/agent/dist/log-broker-entry.js"
for candidate_path in "$candidate_log_unit" "$candidate_agent_unit" "$candidate_broker_entry"; do
  [[ -f "$candidate_path" && ! -L "$candidate_path" ]] || blocked "candidate_file_invalid:${candidate_path#"$CANDIDATE_ROOT"/}"
done
[[ -s "$candidate_broker_entry" ]] || blocked 'candidate_log_broker_entry_empty'
candidate_log_unit_sha="$(sha256_path "$candidate_log_unit" 2>/dev/null || true)"
candidate_agent_unit_sha="$(sha256_path "$candidate_agent_unit" 2>/dev/null || true)"
candidate_broker_entry_size="$(stat -Lc '%s' "$candidate_broker_entry" 2>/dev/null || true)"
printf 'CANDIDATE_LOG_BROKER_UNIT_SHA256=%s\n' "$candidate_log_unit_sha"
printf 'CANDIDATE_AGENT_UNIT_SHA256=%s\n' "$candidate_agent_unit_sha"
printf 'CANDIDATE_LOG_BROKER_ENTRY_SIZE=%s\n' "$candidate_broker_entry_size"

health_status="$(http_status "${WEB_BASE}/api/health" 5)"
host_status="$(http_status "${WEB_BASE}/api/current/host" 8)"
docker_status="$(http_status "${WEB_BASE}/api/current/docker" 12)"
logs_status="$(http_status "${WEB_BASE}/api/logs/sources" 8)"
quick_status="$(http_status "${WEB_BASE}/api/quick-commands" 8)"
[[ "$health_status" == '200' ]] || blocked 'product_health_failed'
[[ "$host_status" == '200' ]] || blocked 'product_host_failed'
[[ "$docker_status" == '200' ]] || blocked 'product_docker_failed'
[[ "$logs_status" == '200' ]] || blocked 'product_logs_catalog_failed'
[[ "$quick_status" == '200' ]] || blocked 'product_quick_commands_failed'
printf 'PRODUCT_HEALTH_HTTP=%s\n' "$health_status"
printf 'PRODUCT_HOST_HTTP=%s\n' "$host_status"
printf 'PRODUCT_DOCKER_HTTP=%s\n' "$docker_status"
printf 'PRODUCT_LOGS_SOURCES_HTTP=%s\n' "$logs_status"
printf 'PRODUCT_QUICK_COMMANDS_HTTP=%s\n' "$quick_status"

node tools/production-candidate-manifest.mjs \
  --root "$CANDIDATE_ROOT" \
  --sha "$SOURCE_SHA" \
  --verify "$MANIFEST" >/dev/null \
  || blocked 'candidate_manifest_verify_failed'
printf 'CANDIDATE_MANIFEST_VERIFY=PASS\n'

PLAN_JSON="$(
  node tools/production-release-controller.mjs \
    --candidate-root "$CANDIDATE_ROOT" \
    --manifest "$MANIFEST" \
    --sha "$SOURCE_SHA"
)" || blocked 'release_controller_plan_failed'

PLAN_FIELDS="$(
  printf '%s' "$PLAN_JSON" | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const value = JSON.parse(input);
    const operations = Array.isArray(value.operations) ? value.operations.join(",") : "";
    for (const item of [
      value.status,
      value.action,
      value.sourceSha,
      value.observedCurrent,
      value.targetRelease,
      value.candidateSha256,
      operations,
    ]) {
      process.stdout.write(String(item ?? "") + "\n");
    }
  } catch {
    process.exitCode = 1;
  }
});
'
)" || blocked 'release_controller_plan_parse_failed'

mapfile -t plan_fields <<<"$PLAN_FIELDS"
((${#plan_fields[@]} == 7)) || blocked 'release_controller_plan_shape_invalid'
plan_status="${plan_fields[0]}"
plan_action="${plan_fields[1]}"
plan_sha="${plan_fields[2]}"
plan_current="${plan_fields[3]}"
plan_target="${plan_fields[4]}"
plan_digest="${plan_fields[5]}"
plan_operations="${plan_fields[6]}"

[[ "$plan_status" == 'PLAN' ]] || blocked 'release_controller_status_invalid'
[[ "$plan_action" == 'activate' ]] || blocked 'release_controller_action_invalid'
[[ "$plan_sha" == "$SOURCE_SHA" ]] || blocked 'release_controller_sha_mismatch'
[[ "$plan_current" == "$CURRENT_RELEASE" ]] || blocked 'release_controller_current_drift'
[[ "$plan_target" == 'absent' ]] || blocked 'release_controller_target_not_absent'
[[ "$plan_digest" =~ ^[0-9a-f]{64}$ ]] || blocked 'release_controller_candidate_digest_invalid'
[[ "$plan_operations" == 'copy_manifest_allowlisted_release,write_verified_manifest_marker,atomic_current_symlink_swap' ]] \
  || blocked 'release_controller_operations_invalid'

printf 'RELEASE_CONTROLLER_PLAN=PASS\n'
printf 'PLAN_OBSERVED_CURRENT=%s\n' "$plan_current"
printf 'PLAN_TARGET_RELEASE=%s\n' "$plan_target"
printf 'PLAN_CANDIDATE_SHA256=%s\n' "$plan_digest"
printf 'PLAN_OPERATIONS=%s\n' "$plan_operations"

printf 'PRODUCTION_MUTATION=NO\n'
printf 'SYSTEMD_MUTATION=NO\n'
printf 'IDENTITY_PERMISSION_MUTATION=NO\n'
printf 'DOCKER_AUTHORITY_MUTATION=NO\n'
printf 'CLOUDFLARE_MUTATION=NO\n'
printf 'TERMINAL_ACTIVATION=NO\n'
printf 'RESULT=READ_ONLY_RECOVERY_PREFLIGHT_PASS\n'