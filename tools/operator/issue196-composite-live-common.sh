github_branch_sha() {
  local api="$1"
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    "${api}/branches/main" |
    node -e '
      let s="";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", c => s += c);
      process.stdin.on("end", () => {
        const j=JSON.parse(s);
        const sha=j?.commit?.sha;
        if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) process.exit(2);
        process.stdout.write(sha);
      });
    '
}

require_push_ci_success() {
  local api="$1"
  local sha="$2"
  local workflow_name="$3"
  local encoded
  encoded="${api}/actions/runs?head_sha=${sha}&event=push&per_page=20"
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "$encoded" |
    node -e '
      let s="";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", c => s += c);
      process.stdin.on("end", () => {
        const j=JSON.parse(s);
        const expected=process.argv[1];
        const runs=Array.isArray(j?.workflow_runs) ? j.workflow_runs : [];
        const ok=runs.some(r => r?.name === expected && r?.head_sha === process.argv[2] &&
          r?.event === "push" && r?.status === "completed" && r?.conclusion === "success");
        if (!ok) process.exit(3);
      });
    ' "$workflow_name" "$sha"
}

http_status() {
  local url="$1"
  local status
  status="$(curl --silent --show-error --connect-timeout 3 --max-time 8 \
    --output /dev/null --write-out '%{http_code}' "$url" 2>/dev/null || true)"
  [[ "$status" =~ ^[0-9]{3}$ ]] || status="000"
  printf '%s' "$status"
}

require_http_200() {
  local path="$1"
  local label="$2"
  local status
  status="$(http_status "${WEB_BASE}${path}")"
  [[ "$status" == "200" ]] || fail "${label} expected 200, got ${status}"
}

current_release_sha() {
  local target release
  target="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  release="${target##*/}"
  [[ "$release" =~ ^[0-9a-f]{40}$ ]] || fail "production current release is not an exact SHA"
  printf '%s' "$release"
}

require_agent_groups() {
  local groups
  groups="$(id -nG "$AGENT_USER" 2>/dev/null || true)"
  [[ -n "$groups" ]] || fail "cannot resolve dashboard agent groups"
  for forbidden in docker video adm systemd-journal; do
    if tr ' ' '\n' <<<"$groups" | grep -Fxq "$forbidden"; then
      fail "dashboard agent gained forbidden group: ${forbidden}"
    fi
  done
}

require_terminal_absent() {
  [[ ! -S /run/dashboard-rpi5-terminal.sock ]] || fail "terminal socket unexpectedly present"
  local state
  state="$(systemctl is-active dashboard-rpi5-terminal.socket 2>/dev/null || true)"
  [[ "$state" != "active" ]] || fail "terminal socket unit unexpectedly active"
}

require_service_active() {
  local service="$1"
  [[ "$(systemctl is-active "$service" 2>/dev/null || true)" == "active" ]] ||
    fail "required service is not active: ${service}"
}

require_web_env_metadata() {
  local metadata
  metadata="$(stat -Lc '%u:%g:%a:%F' "$WEB_ENV" 2>/dev/null || true)"
  [[ "$metadata" == "0:0:600:regular file" ]] ||
    fail "web env metadata differs from reviewed root:root 0600 regular-file boundary"
}

require_backup_baseline() {
  [[ -f "$BACKUP_ENTRYPOINT" && ! -L "$BACKUP_ENTRYPOINT" ]] ||
    fail "backup entrypoint is not a real file"
  local digest
  digest="$(sha256sum "$BACKUP_ENTRYPOINT" | awk '{print $1}')"
  [[ "$digest" == "$TRUSTED_BACKUP_SHA256" ]] ||
    fail "backup incumbent is not the reviewed V10 byte-identical core"
}

require_public_access_boundary() {
  local status
  status="$(http_status "$PUBLIC_DASHBOARD_URL")"
  case "$status" in
    301|302|303|307|308|401|403) ;;
    *) fail "public dashboard boundary no longer presents an access/intercept response" ;;
  esac
}

discover_prometheus_target() {
  local binding line_count host port
  binding="$(docker port prometheus 9090/tcp 2>/dev/null || true)"
  line_count="$(grep -cve '^[[:space:]]*$' <<<"$binding" || true)"
  [[ "$line_count" == "1" ]] || fail "Prometheus must expose exactly one reviewed 9090/tcp host binding"
  binding="$(sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' <<<"$binding")"
  host="${binding%:*}"
  port="${binding##*:}"
  host="${host#[}"
  host="${host%]}"
  [[ "$port" == "9090" ]] || fail "unexpected Prometheus published port"
  [[ "$host" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ || "$host" == "127.0.0.1" ]] ||
    fail "Prometheus binding is not a reviewed IPv4 host target"
  [[ "$host" != "0.0.0.0" ]] || fail "Prometheus wildcard binding is not accepted for dashboard target discovery"
  PROMETHEUS_URL="http://${host}:9090"
  [[ "$(http_status "${PROMETHEUS_URL}/-/ready")" == "200" ]] || fail "Prometheus readiness target is not reachable"
  [[ "$(http_status "${PROMETHEUS_URL}/api/v1/query?query=node_load1")" == "200" ]] ||
    fail "Prometheus query target is not reachable"
  PROMETHEUS_URL_SHA256="$(printf '%s' "$PROMETHEUS_URL" | sha256sum | awk '{print $1}')"
}

configure_run_paths() {
  RUN_ROOT="${HOME}/.cache/dashboard-rpi5-operator/issue196-${TARGET_SHA}-backup-${RUN_BACKUP}"
  DASHBOARD_CLONE="${RUN_ROOT}/dashboard"
  PRODUCER_CLONE="${RUN_ROOT}/producer"
  PRODUCER_STAGE="${RUN_ROOT}/producer-stage"
  MANIFEST="${RUN_ROOT}/production-candidate.json"
  RECEIPT="${RUN_ROOT}/preflight.receipt"
}

init_dashboard_candidate() {
  mkdir -p "$RUN_ROOT"
  [[ ! -e "$DASHBOARD_CLONE" ]] || fail "dashboard candidate directory already exists; preserve evidence and use the existing receipt"
  git clone --quiet --no-checkout "$DASHBOARD_GIT" "$DASHBOARD_CLONE"
  git -C "$DASHBOARD_CLONE" fetch --quiet origin "$TARGET_SHA" "$FUNCTIONAL_BASE_SHA"
  git -C "$DASHBOARD_CLONE" checkout --quiet --detach "$TARGET_SHA"

  [[ "$(git -C "$DASHBOARD_CLONE" rev-parse "${FUNCTIONAL_BASE_SHA}^{tree}")" == "$FUNCTIONAL_BASE_TREE" ]] ||
    fail "functional base tree mismatch"
  git -C "$DASHBOARD_CLONE" merge-base --is-ancestor "$FUNCTIONAL_BASE_SHA" "$TARGET_SHA" ||
    fail "dashboard main no longer descends from reviewed #196 functional base"

  local changed path allowed
  changed="$(git -C "$DASHBOARD_CLONE" diff --name-only "$FUNCTIONAL_BASE_SHA" "$TARGET_SHA")"
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    allowed="NO"
    for candidate in "${ALLOWED_TARGET_DIFF[@]}"; do
      [[ "$path" == "$candidate" ]] && allowed="YES"
    done
    [[ "$allowed" == "YES" ]] || fail "dashboard main contains unrelated post-#200 source: ${path}"
  done <<<"$changed"

  for required in \
    "apps/agent/src/production-log-sources.ts" \
    "docs/ISSUE196_COMPOSITE_LIVE_RESTORATION.md" \
    "tools/operator/issue196-composite-live-restoration.sh"; do
    grep -Fxq "$required" <<<"$changed" || fail "reviewed restoration gate file missing from target: ${required}"
  done
}

init_producer_source() {
  mkdir -p "$PRODUCER_STAGE"
  git clone --quiet --no-checkout "$PRODUCER_GIT" "$PRODUCER_CLONE"
  git -C "$PRODUCER_CLONE" fetch --quiet origin "$PRODUCER_CURRENT_SHA" "$PRODUCER_REVIEWED_SHA"
  git -C "$PRODUCER_CLONE" checkout --quiet --detach "$PRODUCER_CURRENT_SHA"
  git -C "$PRODUCER_CLONE" merge-base --is-ancestor "$PRODUCER_REVIEWED_SHA" "$PRODUCER_CURRENT_SHA" ||
    fail "current RPi5_main no longer descends from reviewed producer merge"

  local path observed
  for path in "${!PRODUCER_BLOBS[@]}"; do
    observed="$(git -C "$PRODUCER_CLONE" rev-parse "${PRODUCER_CURRENT_SHA}:${path}")"
    [[ "$observed" == "${PRODUCER_BLOBS[$path]}" ]] ||
      fail "producer blob drift detected: ${path}"
  done

  git -C "$PRODUCER_CLONE" show "${PRODUCER_REVIEWED_SHA}:ops/lib/dashboard-evidence.py" >"${PRODUCER_STAGE}/dashboard-evidence.py"
  git -C "$PRODUCER_CLONE" show "${PRODUCER_REVIEWED_SHA}:ops/lib/rpi5-maintenance-locks.sh" >"${PRODUCER_STAGE}/rpi5-maintenance-locks.sh"
  git -C "$PRODUCER_CLONE" show "${PRODUCER_REVIEWED_SHA}:ops/bin/rpi5-dashboard-evidence" >"${PRODUCER_STAGE}/rpi5-dashboard-evidence"
  git -C "$PRODUCER_CLONE" show "${PRODUCER_REVIEWED_SHA}:ops/bin/rpi5-backup" >"${PRODUCER_STAGE}/rpi5-backup-v10-core"
  git -C "$PRODUCER_CLONE" show "${PRODUCER_REVIEWED_SHA}:ops/bin/rpi5-backup-serialized" >"${PRODUCER_STAGE}/rpi5-backup-serialized"
  git -C "$PRODUCER_CLONE" show "${PRODUCER_REVIEWED_SHA}:ops/systemd/rpi5-dashboard-evidence.service" >"${PRODUCER_STAGE}/rpi5-dashboard-evidence.service"
  git -C "$PRODUCER_CLONE" show "${PRODUCER_REVIEWED_SHA}:ops/systemd/rpi5-dashboard-evidence.timer" >"${PRODUCER_STAGE}/rpi5-dashboard-evidence.timer"

  [[ "$(sha256sum "${PRODUCER_STAGE}/rpi5-backup-v10-core" | awk '{print $1}')" == "$TRUSTED_BACKUP_SHA256" ]] ||
    fail "staged producer backup core is not byte-identical to reviewed V10"
  bash -n "${PRODUCER_STAGE}/rpi5-dashboard-evidence"
  bash -n "${PRODUCER_STAGE}/rpi5-backup-serialized"
  python3 -m py_compile "${PRODUCER_STAGE}/dashboard-evidence.py"
}

build_candidate() {
  npm --prefix "$DASHBOARD_CLONE" ci --ignore-scripts
  npm_config_build_from_source=true npm --prefix "$DASHBOARD_CLONE" rebuild node-pty --dangerously-allow-all-scripts
  (
    cd "$DASHBOARD_CLONE"
    node --input-type=module -e '
      import("node-pty").then((m) => {
        if (typeof m.spawn !== "function") process.exit(2);
      }).catch(() => process.exit(3));
    '
  )
  npm --prefix "$DASHBOARD_CLONE" audit --audit-level=high
  npm --prefix "$DASHBOARD_CLONE" run check
  node "$DASHBOARD_CLONE/tools/production-candidate-manifest.mjs" \
    --root "$DASHBOARD_CLONE" --sha "$TARGET_SHA" >"$MANIFEST"
  node "$DASHBOARD_CLONE/tools/production-candidate-manifest.mjs" \
    --root "$DASHBOARD_CLONE" --sha "$TARGET_SHA" --verify "$MANIFEST"
  node "$DASHBOARD_CLONE/tools/production-runtime-smoke.mjs" \
    --root "$DASHBOARD_CLONE" --manifest "$MANIFEST" --sha "$TARGET_SHA"
}
