wait_web_200() {
  local path="$1" label="$2"
  local attempt status
  for attempt in $(seq 1 30); do
    status="$(http_status "${WEB_BASE}${path}")"
    [[ "$status" == "200" ]] && return 0
    sleep 2
  done
  fail "${label} did not reach HTTP 200"
}

install_producer_source() {
  sudo /usr/bin/install -d -o root -g root -m 0755 /usr/local/lib/rpi5-maintenance
  sudo /usr/bin/install -o root -g root -m 0644 "${PRODUCER_STAGE}/dashboard-evidence.py" "$PRODUCER_HELPER"
  sudo /usr/bin/install -o root -g root -m 0644 "${PRODUCER_STAGE}/rpi5-maintenance-locks.sh" "$LOCK_HELPER"
  sudo /usr/bin/install -o root -g root -m 0755 "${PRODUCER_STAGE}/rpi5-dashboard-evidence" "$PRODUCER_WRAPPER"
  sudo /usr/bin/install -o root -g root -m 0755 "${PRODUCER_STAGE}/rpi5-backup-v10-core" "$BACKUP_CORE"
  sudo /usr/bin/install -o root -g root -m 0755 "${PRODUCER_STAGE}/rpi5-backup-serialized" "$BACKUP_ENTRYPOINT"
  sudo /usr/bin/install -o root -g root -m 0644 "${PRODUCER_STAGE}/rpi5-dashboard-evidence.service" "/etc/systemd/system/${EVIDENCE_SERVICE}"
  sudo /usr/bin/install -o root -g root -m 0644 "${PRODUCER_STAGE}/rpi5-dashboard-evidence.timer" "/etc/systemd/system/${EVIDENCE_TIMER}"
}

update_prometheus_env_without_disclosure() {
  local expected_hash="$1"
  sudo /usr/bin/env ISSUE196_PROMETHEUS_HASH="$expected_hash" /usr/bin/python3 - <<'PY'
from __future__ import annotations
import hashlib
import os
import stat
import subprocess
import tempfile

path="/etc/dashboard-rpi5/web.env"
expected=os.environ.get("ISSUE196_PROMETHEUS_HASH","")
if len(expected) != 64:
    raise SystemExit("invalid expected target hash")
binding=subprocess.check_output(
    ["/usr/bin/docker","port","prometheus","9090/tcp"], text=True, timeout=5
).strip()
if "\n" in binding or ":" not in binding:
    raise SystemExit("unexpected Prometheus binding")
host,port=binding.rsplit(":",1)
host=host.strip("[]")
if port != "9090" or host in {"0.0.0.0","::",""}:
    raise SystemExit("unsafe Prometheus binding")
url=f"http://{host}:9090"
if hashlib.sha256(url.encode()).hexdigest() != expected:
    raise SystemExit("Prometheus target drifted since preflight")

st=os.lstat(path)
if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode):
    raise SystemExit("web env is not a real file")
if st.st_uid != 0 or st.st_gid != 0 or stat.S_IMODE(st.st_mode) != 0o600:
    raise SystemExit("web env metadata drift")
with open(path,"r",encoding="utf-8") as handle:
    raw=handle.read(65537)
if len(raw.encode("utf-8")) > 65536:
    raise SystemExit("web env too large")
lines=raw.splitlines()
if any(line.strip() == "DASHBOARD_TERMINAL_ENABLED=enabled" for line in lines):
    raise SystemExit("terminal activation is outside issue196 scope")
prefix="DASHBOARD_PROMETHEUS_URL="
matches=[i for i,line in enumerate(lines) if line.startswith(prefix)]
if len(matches) > 1:
    raise SystemExit("duplicate Prometheus env key")
replacement=prefix+url
if matches:
    lines[matches[0]]=replacement
else:
    lines.append(replacement)
payload=("\n".join(lines)+"\n").encode("utf-8")
parent=os.path.dirname(path)
fd,tmp=tempfile.mkstemp(prefix=".web.env.issue196.",dir=parent)
try:
    os.fchmod(fd,0o600)
    os.fchown(fd,0,0)
    with os.fdopen(fd,"wb",closefd=False) as out:
        out.write(payload)
        out.flush()
        os.fsync(out.fileno())
    os.close(fd)
    fd=-1
    os.replace(tmp,path)
    dfd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY)
    try:
        os.fsync(dfd)
    finally:
        os.close(dfd)
finally:
    if fd >= 0:
        os.close(fd)
    try:
        os.unlink(tmp)
    except FileNotFoundError:
        pass
PY
}

require_evidence_files() {
  local name metadata
  for name in endpoints.json throttle.json; do
    metadata="$(stat -Lc '%u:%g:%a:%F' "${EVIDENCE_ROOT}/${name}" 2>/dev/null || true)"
    [[ "$metadata" == "0:0:644:regular file" ]] ||
      fail "expected evidence file missing or unsafe: ${name}"
  done
  if [[ -e "${EVIDENCE_ROOT}/maintenance.json" ]]; then
    metadata="$(stat -Lc '%u:%g:%a:%F' "${EVIDENCE_ROOT}/maintenance.json" 2>/dev/null || true)"
    [[ "$metadata" == "0:0:644:regular file" ]] || fail "maintenance evidence metadata is unsafe"
  fi
}

require_production_log_registry() {
  curl --fail --silent --show-error --connect-timeout 3 --max-time 8 "${WEB_BASE}/api/logs/sources" |
    node -e '
      let s="";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data",c=>s+=c);
      process.stdin.on("end",()=>{
        const j=JSON.parse(s);
        const ids=Array.isArray(j?.sources) ? j.sources.map(x=>x?.sourceId) : null;
        const expected=["docker:homeassistant","docker:prometheus"];
        if (!ids || JSON.stringify(ids)!==JSON.stringify(expected)) process.exit(2);
      });
    '
}

require_docker_stats_available() {
  curl --fail --silent --show-error --connect-timeout 3 --max-time 10 "${WEB_BASE}/api/current/docker" |
    node -e '
      let s="";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data",c=>s+=c);
      process.stdin.on("end",()=>{
        const j=JSON.parse(s);
        if (!Array.isArray(j?.containers)) process.exit(2);
        const running=j.containers.filter(x=>x?.state==="RUNNING");
        const unavailable=running.filter(x=>x?.statsState!=="AVAILABLE");
        if (running.length === 0 || unavailable.length !== 0) process.exit(3);
      });
    '
}

record_deploy_evidence() {
  local short occurred transaction
  short="${TARGET_SHA:0:12}"
  occurred="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  transaction="$(date -u +%Y%m%dT%H%M%S%6NZ)-${short}"
  sudo /usr/bin/python3 "$PRODUCER_HELPER" deploy-record \
    --transaction-id "$transaction" \
    --commit "$short" \
    --occurred-at "$occurred"
}

final_acceptance() {
  wait_web_200 "/api/health" "web health"
  wait_web_200 "/api/current/host" "host"
  wait_web_200 "/api/current/docker" "Docker"
  wait_web_200 "/api/services" "services"
  wait_web_200 "/api/history/host?range=24h" "Prometheus history"
  wait_web_200 "/api/endpoints" "public endpoints"
  wait_web_200 "/api/logs/sources" "log source registry"
  wait_web_200 "/api/logs?sourceId=docker%3Aprometheus&range=1h" "Docker Prometheus logs"
  require_production_log_registry
  require_docker_stats_available
  require_evidence_files
  require_agent_groups
  require_terminal_absent
  require_public_access_boundary
  [[ "$(current_release_sha)" == "$TARGET_SHA" ]] || fail "production current pointer differs from exact target"
  if [[ "$RUN_BACKUP" == "YES" ]]; then
    wait_web_200 "/api/backups" "backup evidence"
  fi
}
