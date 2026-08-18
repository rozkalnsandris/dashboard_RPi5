#!/usr/bin/env bash
set -Eeuo pipefail

UPSTREAM_COMMIT="98675a34d1b9d06f4d3a906232d3789a475997c7"
UPSTREAM_BLOB="929efcd04810af07b2fda5daa4d0c52658a24b24"
UPSTREAM_PATH="tools/operator/phase128-post136-production-activate.sh"
EXPECTED_AGGREGATE_SERVER_DIST_SHA="48507348b12cb54693e3c5a790460afb5b400b9a3400f2751b509700c6e33778"
EXPECTED_MANIFEST_SHA="2cc46ad30787355eead24aab90d769cd8cf984fcc8d811ae637939b83abddaf7"
EXPECTED_OWNER_ACK="I_AUTHORIZE_PHASE128_POST136_ACTIVATE_1D9C27A9C2AC2370BC626807E14C5786DE58671B6547DFC2F5C822EFA45E0A2E"
WORKSPACE="$HOME/.cache/dashboard-rpi5-candidate-prep/15f44e3a6fdda8f2e97b26501a283f6bba915e86-post136"
MANIFEST="$WORKSPACE/production-candidate.json"

blocked() {
  echo "PHASE128_POST136_V2_BLOCKED: $*" >&2
  exit 1
}

for command_name in curl git jq sha256sum python3 bash mktemp; do
  command -v "$command_name" >/dev/null 2>&1 || blocked "missing command: $command_name"
done

if [ "$#" -eq 1 ] && [ "$1" = "--preflight-only" ]; then
  mode="preflight"
  upstream_args=(--preflight-only)
elif [ "$#" -eq 2 ] && [ "$1" = "--owner-ack" ] && [ "$2" = "$EXPECTED_OWNER_ACK" ]; then
  mode="activate"
  upstream_args=(--owner-ack "$EXPECTED_OWNER_ACK")
else
  blocked "usage: $0 --preflight-only | --owner-ack <exact-ack>"
fi

[ -f "$MANIFEST" ] || blocked "candidate manifest missing"
actual_manifest_sha="$(sha256sum "$MANIFEST" | awk '{print $1}')"
[ "$actual_manifest_sha" = "$EXPECTED_MANIFEST_SHA" ] \
  || blocked "candidate manifest digest drift expected=$EXPECTED_MANIFEST_SHA actual=$actual_manifest_sha"

server_entry_count="$(jq -er --arg path 'apps/server/dist/index.js' '[.files[] | select(.path == $path)] | length' "$MANIFEST")"
[ "$server_entry_count" -eq 1 ] || blocked "candidate manifest must contain exactly one server launch entry"
server_entry_sha="$(jq -er --arg path 'apps/server/dist/index.js' '.files[] | select(.path == $path) | .sha256' "$MANIFEST")"
[[ "$server_entry_sha" =~ ^[0-9a-f]{64}$ ]] || blocked "candidate server launch entry digest is invalid"
[ "$server_entry_sha" != "$EXPECTED_AGGREGATE_SERVER_DIST_SHA" ] \
  || blocked "server launch entry unexpectedly equals aggregate dist digest"

workdir="$(mktemp -d "${TMPDIR:-/tmp}/dashboard-rpi5-phase128-v2.XXXXXX")"
upstream="$workdir/upstream.sh"
patched="$workdir/patched.sh"

curl -fsSL \
  "https://raw.githubusercontent.com/rozkalnsandris/dashboard_RPi5/$UPSTREAM_COMMIT/$UPSTREAM_PATH" \
  -o "$upstream" \
  || blocked "exact upstream helper download failed"

actual_upstream_blob="$(git hash-object "$upstream")"
[ "$actual_upstream_blob" = "$UPSTREAM_BLOB" ] \
  || blocked "upstream helper blob mismatch expected=$UPSTREAM_BLOB actual=$actual_upstream_blob"

python3 - "$upstream" "$patched" "$server_entry_sha" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text(encoding="utf-8")
destination = Path(sys.argv[2])
server_sha = sys.argv[3]
old = 'EXPECTED_SERVER_ENTRY_SHA="48507348b12cb54693e3c5a790460afb5b400b9a3400f2751b509700c6e33778"'
new = f'EXPECTED_SERVER_ENTRY_SHA="{server_sha}"'
if source.count(old) != 1:
    raise SystemExit("expected exactly one aggregate server digest binding")
patched = source.replace(old, new, 1)
if old in patched or patched.count(new) != 1:
    raise SystemExit("server launch entry binding replacement failed")
destination.write_text(patched, encoding="utf-8")
PY

bash -n "$patched" || blocked "patched helper bash syntax failed"
patched_blob="$(git hash-object "$patched")"

printf 'PHASE128_POST136_V2_PATCH_PASS mode=%s upstream_commit=%s upstream_blob=%s manifest_sha256=%s server_entry_sha256=%s patched_blob=%s\n' \
  "$mode" "$UPSTREAM_COMMIT" "$UPSTREAM_BLOB" "$actual_manifest_sha" "$server_entry_sha" "$patched_blob"
printf 'PHASE128_POST136_V2_EXEC upstream_mode=%s production_mutation_before_exec=NO authorization_consumed_before_exec=NO\n' "$mode"

# No production mutation occurs in this wrapper. From this point onward the
# exact-reviewed upstream helper owns the mutation boundary and STOP semantics.
exec bash "$patched" "${upstream_args[@]}"
