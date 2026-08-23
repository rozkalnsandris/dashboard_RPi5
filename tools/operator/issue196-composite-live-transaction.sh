verify_preflight_baseline() {
  EXPECTED_CURRENT_SHA="$(current_release_sha)"
  require_service_active "$BROKER_SERVICE"
  require_service_active "$AGENT_SERVICE"
  require_service_active "$WEB_SERVICE"
  require_agent_groups
  require_terminal_absent
  require_web_env_metadata
  require_backup_baseline
  require_public_access_boundary
  require_http_200 "/api/health" "web health"
  require_http_200 "/api/current/host" "host"
  require_http_200 "/api/current/docker" "Docker"
  require_http_200 "/api/services" "services"
  require_http_200 "/api/logs/sources" "log source registry"
  require_http_200 "/api/logs?sourceId=docker%3Aprometheus&range=1h" "Docker Prometheus logs"

  local producer_state timer_state
  producer_state="$(systemctl is-active "$EVIDENCE_SERVICE" 2>/dev/null || true)"
  timer_state="$(systemctl is-active "$EVIDENCE_TIMER" 2>/dev/null || true)"
  [[ "$producer_state" != "active" && "$timer_state" != "active" ]] ||
    fail "evidence producer is unexpectedly active before authorized rollout"

  discover_prometheus_target
}

write_receipt() {
  local manifest_sha
  manifest_sha="$(sha256sum "$MANIFEST" | awk '{print $1}')"
  umask 077
  {
    printf 'RESULT=PASS\n'
    printf 'TARGET_SHA=%s\n' "$TARGET_SHA"
    printf 'FUNCTIONAL_BASE_SHA=%s\n' "$FUNCTIONAL_BASE_SHA"
    printf 'EXPECTED_CURRENT_SHA=%s\n' "$EXPECTED_CURRENT_SHA"
    printf 'PRODUCER_CURRENT_SHA=%s\n' "$PRODUCER_CURRENT_SHA"
    printf 'PRODUCER_REVIEWED_SHA=%s\n' "$PRODUCER_REVIEWED_SHA"
    printf 'PROMETHEUS_URL_SHA256=%s\n' "$PROMETHEUS_URL_SHA256"
    printf 'RUN_BACKUP=%s\n' "$RUN_BACKUP"
    printf 'MANIFEST_SHA256=%s\n' "$manifest_sha"
    printf 'PRODUCTION_MUTATION=NO\n'
    printf 'SYSTEMD_MUTATION=NO\n'
    printf 'IDENTITY_PERMISSION_MUTATION=NO\n'
    printf 'DOCKER_AUTHORITY_MUTATION=NO\n'
    printf 'CLOUDFLARE_MUTATION=NO\n'
    printf 'TERMINAL_ACTIVATION=NO\n'
  } >"$RECEIPT"
  chmod 0600 "$RECEIPT"
  printf 'PREFLIGHT_RECEIPT=%s\n' "$RECEIPT"
  printf 'PREFLIGHT_RECEIPT_SHA256=%s\n' "$(sha256sum "$RECEIPT" | awk '{print $1}')"
}

receipt_value() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" "$RECEIPT" | cut -d= -f2- || true)"
  [[ -n "$value" ]] || fail "receipt key missing: ${key}"
  printf '%s' "$value"
}

load_receipt() {
  [[ -f "$RECEIPT" && ! -L "$RECEIPT" ]] || fail "preflight receipt missing"
  [[ "$(sha256sum "$RECEIPT" | awk '{print $1}')" == "$RECEIPT_SHA256" ]] ||
    fail "preflight receipt hash mismatch"
  [[ "$(receipt_value RESULT)" == "PASS" ]] || fail "receipt is not PASS"
  [[ "$(receipt_value TARGET_SHA)" == "$TARGET_SHA" ]] || fail "receipt target mismatch"
  [[ "$(receipt_value PRODUCER_CURRENT_SHA)" == "$PRODUCER_CURRENT_SHA" ]] || fail "receipt producer-main mismatch"
  [[ "$(receipt_value PRODUCER_REVIEWED_SHA)" == "$PRODUCER_REVIEWED_SHA" ]] || fail "receipt producer-reviewed mismatch"
  [[ "$(receipt_value RUN_BACKUP)" == "$RUN_BACKUP" ]] || fail "receipt backup category mismatch"
  EXPECTED_CURRENT_SHA="$(receipt_value EXPECTED_CURRENT_SHA)"
  [[ "$EXPECTED_CURRENT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "receipt current release invalid"
  PROMETHEUS_URL_SHA256="$(receipt_value PROMETHEUS_URL_SHA256)"
  [[ "$PROMETHEUS_URL_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail "receipt Prometheus hash invalid"
  [[ "$(sha256sum "$MANIFEST" | awk '{print $1}')" == "$(receipt_value MANIFEST_SHA256)" ]] ||
    fail "candidate manifest changed since preflight"
}

run_release_controller_plan() {
  local output="${RUN_ROOT}/release-plan-prewrite.json"
  (
    cd "$DASHBOARD_CLONE"
    sudo /usr/bin/node ./tools/production-release-controller.mjs \
      --candidate-root "$DASHBOARD_CLONE" \
      --manifest "$MANIFEST" \
      --sha "$TARGET_SHA"
  ) >"$output"
  node -e '
    const fs=require("fs");
    const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    if (j?.status !== "PLAN" || j?.sourceSha !== process.argv[2]) process.exit(2);
  ' "$output" "$TARGET_SHA"
}

run_release_controller_apply() {
  local output="${RUN_ROOT}/release-applied.json"
  (
    cd "$DASHBOARD_CLONE"
    sudo /usr/bin/node ./tools/production-release-controller.mjs \
      --candidate-root "$DASHBOARD_CLONE" \
      --manifest "$MANIFEST" \
      --sha "$TARGET_SHA" \
      --expected-current "$EXPECTED_CURRENT_SHA" \
      --apply \
      --ack "$CONTROLLER_ACK"
  ) >"$output"
  node -e '
    const fs=require("fs");
    const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    if (j?.status !== "APPLIED" || j?.currentRelease !== process.argv[2]) process.exit(2);
  ' "$output" "$TARGET_SHA"
}
