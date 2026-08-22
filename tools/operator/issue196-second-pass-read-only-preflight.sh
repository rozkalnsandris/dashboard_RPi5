#!/usr/bin/env bash
set -uo pipefail

if [[ "$#" -ne 0 ]]; then
  printf 'usage: %s\n' "${0##*/}" >&2
  exit 64
fi

WEB_BASE='http://127.0.0.1:8787'
CURRENT_LINK='/opt/dashboard_RPi5/current'
AGENT_USER='dashboard-rpi5-agent'
PROMETHEUS_CONTAINER='prometheus'

http_body() {
  local path="$1"
  curl --silent --show-error --connect-timeout 2 --max-time 8 "${WEB_BASE}${path}" 2>/dev/null || true
}

print_current_release() {
  local target release
  target="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  release="${target##*/}"
  if [[ "$release" =~ ^[0-9a-f]{40}$ ]]; then
    printf 'CURRENT_RELEASE=%s\n' "$release"
  else
    printf 'CURRENT_RELEASE=UNKNOWN\n'
  fi
}

print_vcio_boundary() {
  local metadata agent_groups operator_result
  metadata="$(stat -Lc '%F:%U:%G:%a' /dev/vcio 2>/dev/null || true)"
  [[ -n "$metadata" ]] || metadata='ABSENT_OR_METADATA_UNAVAILABLE'
  printf 'VCIO_DEVICE_METADATA=%s\n' "$metadata"

  agent_groups="$(id -nG "$AGENT_USER" 2>/dev/null || true)"
  if [[ -z "$agent_groups" ]]; then
    printf 'AGENT_VIDEO_GROUP=UNKNOWN\n'
  elif tr ' ' '\n' <<<"$agent_groups" | grep -Fxq video; then
    printf 'AGENT_VIDEO_GROUP=PRESENT\n'
  else
    printf 'AGENT_VIDEO_GROUP=ABSENT\n'
  fi

  operator_result="$(/usr/bin/vcgencmd get_throttled 2>/dev/null || true)"
  if [[ "$operator_result" =~ ^throttled=0x[0-9a-fA-F]+$ ]]; then
    printf 'VCGENCMD_OPERATOR_RESULT=%s\n' "$operator_result"
  else
    printf 'VCGENCMD_OPERATOR_RESULT=UNAVAILABLE\n'
  fi
}

print_prometheus_topology() {
  local listeners mapping
  listeners="$(ss -ltnH 2>/dev/null | awk '$4 ~ /:9090$/ {count++} END {print count+0}')"
  [[ "$listeners" =~ ^[0-9]+$ ]] || listeners='UNKNOWN'
  printf 'HOST_TCP_9090_LISTENERS=%s\n' "$listeners"

  if ! command -v docker >/dev/null 2>&1; then
    printf 'PROMETHEUS_DOCKER_PORT_9090=DOCKER_CLI_UNAVAILABLE\n'
    return
  fi

  mapping="$(docker port "$PROMETHEUS_CONTAINER" 9090/tcp 2>/dev/null | paste -sd, - || true)"
  if [[ -n "$mapping" ]]; then
    printf 'PROMETHEUS_DOCKER_PORT_9090=%s\n' "$mapping"
  else
    printf 'PROMETHEUS_DOCKER_PORT_9090=NONE_OR_UNAVAILABLE\n'
  fi
}

print_journal_visibility() {
  local groups update_count deploy_count monitor_count
  groups="$(id -nG 2>/dev/null || true)"
  if tr ' ' '\n' <<<"$groups" | grep -Eq '^(adm|systemd-journal)$'; then
    printf 'OPERATOR_JOURNAL_READ_GROUP=PRESENT\n'
  else
    printf 'OPERATOR_JOURNAL_READ_GROUP=ABSENT\n'
  fi

  update_count="$(journalctl --no-pager --output=cat --lines=1 --since='7 days ago' --unit=rpi5-update.service 2>/dev/null | wc -l | tr -d ' ')"
  deploy_count="$(journalctl --no-pager --output=cat --lines=1 --since='30 days ago' _UID=0 _TRANSPORT=syslog SYSLOG_IDENTIFIER=rpi5-deploy 2>/dev/null | wc -l | tr -d ' ')"
  monitor_count="$(journalctl --no-pager --output=cat --lines=1 --since='7 days ago' --grep='RPi5 monitor' 2>/dev/null | wc -l | tr -d ' ')"

  [[ "$update_count" =~ ^[0-9]+$ ]] || update_count=0
  [[ "$deploy_count" =~ ^[0-9]+$ ]] || deploy_count=0
  [[ "$monitor_count" =~ ^[0-9]+$ ]] || monitor_count=0

  (( update_count > 0 )) && printf 'JOURNAL_RPI5_UPDATE_VISIBLE=YES\n' || printf 'JOURNAL_RPI5_UPDATE_VISIBLE=NO\n'
  (( deploy_count > 0 )) && printf 'JOURNAL_RPI5_DEPLOY_VISIBLE=YES\n' || printf 'JOURNAL_RPI5_DEPLOY_VISIBLE=NO\n'
  (( monitor_count > 0 )) && printf 'JOURNAL_RPI5_MONITOR_VISIBLE=YES\n' || printf 'JOURNAL_RPI5_MONITOR_VISIBLE=NO\n'
}

print_backup_boundary() {
  if [[ -r /var/log/rpi5-backup.log ]]; then
    printf 'BACKUP_LOG_OPERATOR_READABLE=YES\n'
  else
    printf 'BACKUP_LOG_OPERATOR_READABLE=NO\n'
  fi
  local metadata
  metadata="$(stat -Lc '%U:%G:%a:%s' /var/log/rpi5-backup.log 2>/dev/null || true)"
  [[ -n "$metadata" ]] || metadata='ABSENT_OR_METADATA_UNAVAILABLE'
  printf 'BACKUP_LOG_METADATA=%s\n' "$metadata"
}

print_docker_stats_boundary() {
  local body parsed unavailable_count direct_output direct_rc start_ms end_ms duration_ms direct_count
  local -a unavailable_names=()

  body="$(http_body '/api/current/docker')"
  if [[ -z "$body" ]]; then
    printf 'DOCKER_STATS_UNAVAILABLE_NAMES=UNKNOWN\n'
    printf 'DOCKER_DIRECT_STATS_RESULT=UNKNOWN\n'
    return
  fi

  parsed="$(printf '%s' "$body" | /usr/bin/node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(input);
    if (!Array.isArray(payload.containers)) throw new Error();
    const names = payload.containers
      .filter((item) => item?.state === "RUNNING" && item?.statsState !== "AVAILABLE" && typeof item?.name === "string")
      .map((item) => item.name)
      .sort();
    process.stdout.write(names.join("\n"));
  } catch {
    process.stdout.write("__UNKNOWN__");
  }
});
' 2>/dev/null || true)"

  if [[ "$parsed" == '__UNKNOWN__' ]]; then
    printf 'DOCKER_STATS_UNAVAILABLE_NAMES=UNKNOWN\n'
    printf 'DOCKER_DIRECT_STATS_RESULT=UNKNOWN\n'
    return
  fi

  if [[ -n "$parsed" ]]; then
    mapfile -t unavailable_names <<<"$parsed"
  fi
  unavailable_count="${#unavailable_names[@]}"
  if (( unavailable_count == 0 )); then
    printf 'DOCKER_STATS_UNAVAILABLE_NAMES=NONE\n'
    printf 'DOCKER_DIRECT_STATS_RESULT=NOT_NEEDED\n'
    return
  fi

  printf 'DOCKER_STATS_UNAVAILABLE_NAMES=%s\n' "$(IFS=,; printf '%s' "${unavailable_names[*]}")"

  if ! command -v docker >/dev/null 2>&1; then
    printf 'DOCKER_DIRECT_STATS_RESULT=DOCKER_CLI_UNAVAILABLE\n'
    return
  fi

  start_ms="$(date +%s%3N 2>/dev/null || true)"
  direct_output="$(timeout 20s docker stats --no-stream --format '{{.Name}}' -- "${unavailable_names[@]}" 2>/dev/null)"
  direct_rc=$?
  end_ms="$(date +%s%3N 2>/dev/null || true)"
  direct_count="$(printf '%s\n' "$direct_output" | sed '/^$/d' | wc -l | tr -d ' ')"

  if [[ "$start_ms" =~ ^[0-9]+$ && "$end_ms" =~ ^[0-9]+$ && "$end_ms" -ge "$start_ms" ]]; then
    duration_ms=$((end_ms - start_ms))
  else
    duration_ms='UNKNOWN'
  fi

  if (( direct_rc == 0 )) && [[ "$direct_count" == "$unavailable_count" ]]; then
    printf 'DOCKER_DIRECT_STATS_RESULT=PASS\n'
  else
    printf 'DOCKER_DIRECT_STATS_RESULT=FAIL:rc=%s:returned=%s:expected=%s\n' "$direct_rc" "$direct_count" "$unavailable_count"
  fi
  printf 'DOCKER_DIRECT_STATS_DURATION_MS=%s\n' "$duration_ms"
}

printf 'STAGE=ISSUE196_SECOND_PASS_READ_ONLY_PREFLIGHT\n'
print_current_release
print_vcio_boundary
print_prometheus_topology
print_journal_visibility
print_backup_boundary
print_docker_stats_boundary
printf 'PRODUCTION_MUTATION=NO\n'
printf 'SYSTEMD_MUTATION=NO\n'
printf 'IDENTITY_PERMISSION_MUTATION=NO\n'
printf 'DOCKER_AUTHORITY_MUTATION=NO\n'
printf 'CLOUDFLARE_MUTATION=NO\n'
printf 'TERMINAL_ACTIVATION=NO\n'
printf 'RESULT=SECOND_PASS_READ_ONLY_EVIDENCE_CAPTURE_COMPLETE\n'
