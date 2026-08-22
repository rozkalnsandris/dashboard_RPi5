#!/usr/bin/env bash
set -uo pipefail

if [[ "$#" -ne 0 ]]; then
  printf 'usage: %s\n' "${0##*/}" >&2
  exit 64
fi

WEB_BASE='http://127.0.0.1:8787'
PROMETHEUS_BASE='http://127.0.0.1:9090'
CURRENT_LINK='/opt/dashboard_RPi5/current'
AGENT_USER='dashboard-rpi5-agent'
BACKUP_EVIDENCE='/var/lib/dashboard-rpi5/evidence/backups.json'
ENDPOINT_EVIDENCE='/var/lib/dashboard-rpi5/evidence/endpoints.json'
BACKUP_LOG='/var/log/rpi5-backup.log'
WEB_ENV='/etc/dashboard-rpi5/web.env'

http_status() {
  local url="$1"
  local status
  status="$(curl --silent --show-error --connect-timeout 2 --max-time 5 --output /dev/null --write-out '%{http_code}' "$url" 2>/dev/null || true)"
  [[ "$status" =~ ^[0-9]{3}$ ]] || status='000'
  printf '%s' "$status"
}

print_api_status() {
  local key="$1"
  local path="$2"
  printf '%s=%s\n' "$key" "$(http_status "${WEB_BASE}${path}")"
}

print_file_state() {
  local key="$1"
  local path="$2"
  local metadata

  if [[ ! -e "$path" ]]; then
    printf '%s=ABSENT\n' "$key"
    return
  fi
  if [[ ! -f "$path" ]]; then
    printf '%s=NOT_REGULAR\n' "$key"
    return
  fi
  metadata="$(stat -Lc '%u:%g:%a:%s' "$path" 2>/dev/null || true)"
  if [[ -z "$metadata" ]]; then
    printf '%s=PRESENT_METADATA_UNAVAILABLE\n' "$key"
    return
  fi
  printf '%s=PRESENT:%s\n' "$key" "$metadata"
}

print_path_metadata() {
  local key="$1"
  local path="$2"
  local metadata

  if [[ ! -e "$path" ]]; then
    printf '%s=ABSENT\n' "$key"
    return
  fi
  metadata="$(stat -Lc '%F:%u:%g:%a' "$path" 2>/dev/null || true)"
  if [[ -z "$metadata" ]]; then
    printf '%s=PRESENT_METADATA_UNAVAILABLE\n' "$key"
    return
  fi
  printf '%s=PRESENT:%s\n' "$key" "$metadata"
}

print_group_capability() {
  local key="$1"
  local pattern="$2"
  local groups
  groups="$(id -nG "$AGENT_USER" 2>/dev/null || true)"
  if [[ -z "$groups" ]]; then
    printf '%s=UNKNOWN\n' "$key"
    return
  fi
  if tr ' ' '\n' <<<"$groups" | grep -Eq "$pattern"; then
    printf '%s=PRESENT\n' "$key"
  else
    printf '%s=ABSENT\n' "$key"
  fi
}

print_services_age() {
  local body result
  body="$(curl --silent --show-error --connect-timeout 2 --max-time 5 "${WEB_BASE}/api/services" 2>/dev/null || true)"
  if [[ -z "$body" ]]; then
    printf 'SERVICES_OBSERVED_AGE_SECONDS=UNKNOWN\n'
    return
  fi
  result="$(printf '%s' "$body" | /usr/bin/node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(input);
    const observed = Date.parse(payload.observedAt);
    const age = Math.floor((Date.now() - observed) / 1000);
    if (!Number.isFinite(observed) || !Number.isSafeInteger(age) || age < 0) throw new Error();
    process.stdout.write(String(age));
  } catch {
    process.stdout.write("UNKNOWN");
  }
});
' 2>/dev/null || true)"
  [[ -n "$result" ]] || result='UNKNOWN'
  printf 'SERVICES_OBSERVED_AGE_SECONDS=%s\n' "$result"
}

print_docker_stats_summary() {
  local body result
  body="$(curl --silent --show-error --connect-timeout 2 --max-time 5 "${WEB_BASE}/api/current/docker" 2>/dev/null || true)"
  if [[ -z "$body" ]]; then
    printf 'DOCKER_RUNNING_CONTAINERS=UNKNOWN\nDOCKER_RUNNING_STATS_UNAVAILABLE=UNKNOWN\n'
    return
  fi
  result="$(printf '%s' "$body" | /usr/bin/node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(input);
    if (!Array.isArray(payload.containers)) throw new Error();
    const running = payload.containers.filter((item) => item?.state === "RUNNING");
    const unavailable = running.filter((item) => item?.statsState !== "AVAILABLE");
    process.stdout.write(`${running.length}:${unavailable.length}`);
  } catch {
    process.stdout.write("UNKNOWN:UNKNOWN");
  }
});
' 2>/dev/null || true)"
  [[ "$result" == *:* ]] || result='UNKNOWN:UNKNOWN'
  printf 'DOCKER_RUNNING_CONTAINERS=%s\n' "${result%%:*}"
  printf 'DOCKER_RUNNING_STATS_UNAVAILABLE=%s\n' "${result#*:}"
}

print_prometheus_series_count() {
  local body result
  body="$(curl --silent --show-error --connect-timeout 2 --max-time 5 --get --data-urlencode 'query=node_load1' "${PROMETHEUS_BASE}/api/v1/query" 2>/dev/null || true)"
  if [[ -z "$body" ]]; then
    printf 'PROMETHEUS_NODE_LOAD_SERIES=UNKNOWN\n'
    return
  fi
  result="$(printf '%s' "$body" | /usr/bin/node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(input);
    const result = payload?.data?.result;
    if (payload?.status !== "success" || !Array.isArray(result)) throw new Error();
    process.stdout.write(String(result.length));
  } catch {
    process.stdout.write("UNKNOWN");
  }
});
' 2>/dev/null || true)"
  [[ -n "$result" ]] || result='UNKNOWN'
  printf 'PROMETHEUS_NODE_LOAD_SERIES=%s\n' "$result"
}

printf 'STAGE=ISSUE196_LIVE_READ_ONLY_DIAGNOSTIC\n'

current_target="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
current_release="${current_target##*/}"
if [[ "$current_release" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'CURRENT_RELEASE=%s\n' "$current_release"
else
  printf 'CURRENT_RELEASE=UNKNOWN\n'
fi

print_api_status WEB_HEALTH_HTTP '/api/health'
print_api_status HOST_HTTP '/api/current/host'
print_api_status DOCKER_HTTP '/api/current/docker'
print_api_status SERVICES_HTTP '/api/services'
print_api_status HISTORY_24H_HTTP '/api/history/host?range=24h'
print_api_status LOG_SOURCES_HTTP '/api/logs/sources'
print_api_status LOG_MAINTENANCE_HTTP '/api/logs?sourceId=systemd%3Arpi5-update&range=1h'
print_api_status LOG_DOCKER_PROMETHEUS_HTTP '/api/logs?sourceId=docker%3Aprometheus&range=1h'
print_api_status BACKUPS_HTTP '/api/backups'
print_api_status ENDPOINTS_HTTP '/api/endpoints'
print_api_status DEPLOYMENTS_HTTP '/api/deployments'

printf 'PROMETHEUS_READY_HTTP=%s\n' "$(http_status "${PROMETHEUS_BASE}/-/ready")"
printf 'PROMETHEUS_QUERY_HTTP=%s\n' "$(http_status "${PROMETHEUS_BASE}/api/v1/query?query=node_load1")"
print_prometheus_series_count
print_services_age
print_docker_stats_summary

print_file_state BACKUP_EVIDENCE_FILE "$BACKUP_EVIDENCE"
print_file_state ENDPOINT_EVIDENCE_FILE "$ENDPOINT_EVIDENCE"
print_file_state BACKUP_LOG_FILE "$BACKUP_LOG"
print_file_state WEB_ENV_FILE "$WEB_ENV"
print_path_metadata VCIO_DEVICE '/dev/vcio'

if [[ -x /usr/bin/vcgencmd ]]; then
  printf 'VCGENCMD_BINARY=EXECUTABLE\n'
else
  printf 'VCGENCMD_BINARY=ABSENT_OR_NOT_EXECUTABLE\n'
fi

print_group_capability AGENT_VIDEO_GROUP '^video$'
print_group_capability AGENT_JOURNAL_READ_GROUP '^(systemd-journal|adm)$'

agent_unit="$(systemctl show dashboard-rpi5-agent.service --no-pager --property=ActiveState --property=SubState --property=User --property=Group --property=SupplementaryGroups 2>/dev/null | tr '\n' ';' || true)"
if [[ -n "$agent_unit" ]]; then
  printf 'AGENT_UNIT_METADATA=%s\n' "$agent_unit"
else
  printf 'AGENT_UNIT_METADATA=UNAVAILABLE\n'
fi

printf 'PRODUCTION_MUTATION=NO\n'
printf 'SYSTEMD_MUTATION=NO\n'
printf 'IDENTITY_PERMISSION_MUTATION=NO\n'
printf 'DOCKER_AUTHORITY_MUTATION=NO\n'
printf 'CLOUDFLARE_MUTATION=NO\n'
printf 'TERMINAL_ACTIVATION=NO\n'
printf 'RESULT=READ_ONLY_EVIDENCE_CAPTURE_COMPLETE\n'