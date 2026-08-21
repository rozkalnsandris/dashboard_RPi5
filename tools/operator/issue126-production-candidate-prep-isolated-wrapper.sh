#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

BASE_MAIN="db6c4383b33dd9902094c54afd60e51a161f8f4c"
BASE_TREE="1a457416331357c54e9dae278769a4ef3690bd7c"
WRAPPER_PR="172"
HELPER_SOURCE="$BASE_MAIN"
HELPER_PATH="tools/operator/issue126-production-candidate-prep.sh"
HELPER_BLOB="3541750f511289056c4a4b8d684db139b9c903eb"
TARGET="a39fc7a9873eedb58cfa49568f9b2e05483cf7c2"
REPO_SLUG="rozkalnsandris/dashboard_RPi5"
ORIGINAL_HOME="$HOME"
OLD_GLOBAL_WORKSPACE="$ORIGINAL_HOME/.cache/dashboard-rpi5-candidate-prep/${TARGET}-issue126"
EXPECTED_FILES='["docs/ISSUE126_ISOLATED_CANDIDATE_PREP_R3.md","package.json","tools/issue126-production-candidate-prep-isolated-wrapper.test.mjs","tools/operator/issue126-production-candidate-prep-isolated-wrapper.sh"]'

blocked() {
  echo "ISSUE126_R3_BLOCKED stage=${stage:-unknown}: $*" >&2
  exit 1
}

RUN_ROOT="uninitialized"
trap 'rc=$?; if [ "$rc" -ne 0 ]; then echo "ISSUE126_R3_WRAPPER_EXIT=$rc RUN_ROOT=$RUN_ROOT PRODUCTION_MUTATION=NO RELEASE_APPLY=NO SYSTEMD_MUTATION=NO IDENTITY_MUTATION=NO PERMISSION_MUTATION=NO CLOUDFLARE_MUTATION=NO SERVICE_RESTART=NO ACTIONS_MUTATION=NO AUTO_RETRY=NO AUTO_CLEANUP=NO" >&2; fi' EXIT

need() { command -v "$1" >/dev/null 2>&1 || blocked "missing command: $1"; }
for c in curl jq base64 mkdir id tr bash tee chmod git awk grep stat; do need "$c"; done

[ "$(id -u)" -ne 0 ] || blocked "run as normal operator, not root"
[ "$(id -un)" = "andris" ] || blocked "run as operator andris"
[ "$ORIGINAL_HOME" = "/home/andris" ] || blocked "unexpected operator HOME: $ORIGINAL_HOME"

MODEL="$(tr -d '\000' < /proc/device-tree/model 2>/dev/null || true)"
case "$MODEL" in
  "Raspberry Pi 5 Model B"*) ;;
  *) blocked "not Raspberry Pi 5 Model B: ${MODEL:-unknown}" ;;
esac

stage="post-merge-source-gate"
printf '%s\n' '=== POST-MERGE IMMUTABLE GITHUB GATE ==='
base_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/commits/$BASE_MAIN")" || blocked "base main lookup failed"
[ "$(printf '%s' "$base_json" | jq -er '.sha')" = "$BASE_MAIN" ] || blocked "base main SHA drift"
[ "$(printf '%s' "$base_json" | jq -er '.commit.tree.sha')" = "$BASE_TREE" ] || blocked "base main tree drift"
[ "$(printf '%s' "$base_json" | jq -er '.commit.verification.verified')" = true ] || blocked "base main signature is not verified"

main_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/branches/main")" || blocked "GitHub main lookup failed"
main_sha="$(printf '%s' "$main_json" | jq -er '.commit.sha')"
[ "$main_sha" != "$BASE_MAIN" ] || blocked "PR172 source is not merged; live main is still PR170 merge"
[ "$(printf '%s' "$main_json" | jq -er '.commit.commit.verification.verified')" = true ] || blocked "live main signature is not verified"

pr_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/pulls/$WRAPPER_PR")" || blocked "PR172 lookup failed"
[ "$(printf '%s' "$pr_json" | jq -er '.state')" = closed ] || blocked "PR172 not closed"
[ "$(printf '%s' "$pr_json" | jq -er '.merged')" = true ] || blocked "PR172 not merged"
[ "$(printf '%s' "$pr_json" | jq -er '.base.sha')" = "$BASE_MAIN" ] || blocked "PR172 base drift"
[ "$(printf '%s' "$pr_json" | jq -er '.merge_commit_sha')" = "$main_sha" ] || blocked "live main is not PR172 squash merge"
wrapper_head="$(printf '%s' "$pr_json" | jq -er '.head.sha')"

main_commit_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/commits/$main_sha")" || blocked "live main commit lookup failed"
[ "$(printf '%s' "$main_commit_json" | jq -er '.commit.verification.verified')" = true ] || blocked "live main commit signature is not verified"
[ "$(printf '%s' "$main_commit_json" | jq -er '.parents | length')" -eq 1 ] || blocked "PR172 merge must have exactly one parent"
[ "$(printf '%s' "$main_commit_json" | jq -er '.parents[0].sha')" = "$BASE_MAIN" ] || blocked "PR172 merge parent drift"

compare_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/compare/$BASE_MAIN...$main_sha")" || blocked "PR172 compare lookup failed"
[ "$(printf '%s' "$compare_json" | jq -er '.status')" = ahead ] || blocked "PR172 compare status drift"
[ "$(printf '%s' "$compare_json" | jq -er '.ahead_by')" -eq 1 ] || blocked "PR172 compare must be exactly one squash commit"
[ "$(printf '%s' "$compare_json" | jq -er '.behind_by')" -eq 0 ] || blocked "PR172 compare unexpectedly behind"
[ "$(printf '%s' "$compare_json" | jq -er '.total_commits')" -eq 1 ] || blocked "PR172 compare total_commits drift"
actual_files="$(printf '%s' "$compare_json" | jq -c '[.files[].filename] | sort')"
[ "$actual_files" = "$EXPECTED_FILES" ] || blocked "PR172 changed-file boundary drift: $actual_files"

runs_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/actions/runs?head_sha=$wrapper_head&event=pull_request&per_page=100")" || blocked "PR172 CI lookup failed"
run_id="$(printf '%s' "$runs_json" | jq -er --arg head "$wrapper_head" '[.workflow_runs[] | select(.name == "CI" and .head_sha == $head and .status == "completed" and .conclusion == "success")] | sort_by(.run_number) | last | .id')" || blocked "PR172 exact-head CI not successful"
jobs_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/actions/runs/$run_id/jobs?per_page=100")" || blocked "PR172 CI jobs lookup failed"
for job_name in "check" "terminal-native (x64)" "terminal-native (arm64)"; do
  count="$(printf '%s' "$jobs_json" | jq -er --arg name "$job_name" '[.jobs[] | select(.name == $name and .status == "completed" and .conclusion == "success")] | length')"
  [ "$count" -eq 1 ] || blocked "required PR172 CI job not success: $job_name count=$count"
done

helper_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/contents/$HELPER_PATH?ref=$HELPER_SOURCE")" || blocked "merged helper lookup failed"
[ "$(printf '%s' "$helper_json" | jq -er '.sha')" = "$HELPER_BLOB" ] || blocked "merged helper blob drift"
printf 'ISSUE126_R3_SOURCE_GATE_PASS base=%s live_main=%s pr172_head=%s ci=%s files=4 helper_blob=%s\n' \
  "$BASE_MAIN" "$main_sha" "$wrapper_head" "$run_id" "$HELPER_BLOB"

stage="one-shot-run-root"
RUN_ROOT="$ORIGINAL_HOME/.cache/dashboard-rpi5-operator/issue126-${main_sha}-r3"
ISOLATED_HOME="$RUN_ROOT/home"
ORIGINAL_HELPER="$RUN_ROOT/original-pr170-helper.sh"
PATCHED_HELPER="$RUN_ROOT/issue126-production-candidate-prep-r3-patched.sh"
HELPER_LOG="$RUN_ROOT/helper-output.log"
mkdir -p "$ORIGINAL_HOME/.cache/dashboard-rpi5-operator"
[ ! -e "$RUN_ROOT" ] || blocked "one-shot run directory already exists: $RUN_ROOT"
mkdir "$RUN_ROOT"
mkdir "$ISOLATED_HOME"
chmod 700 "$RUN_ROOT" "$ISOLATED_HOME"

old_workspace_fingerprint="absent"
if [ -e "$OLD_GLOBAL_WORKSPACE" ]; then
  old_workspace_fingerprint="$(stat -Lc '%d:%i:%s:%Y' "$OLD_GLOBAL_WORKSPACE")" || blocked "old global workspace stat failed"
fi
printf 'ISSUE126_R3_WRAPPER_START model=%s base=%s live_main=%s run_root=%s isolated_home=%s\n' \
  "$MODEL" "$BASE_MAIN" "$main_sha" "$RUN_ROOT" "$ISOLATED_HOME"
printf 'OLD_GLOBAL_WORKSPACE_PRESERVED=%s fingerprint=%s\n' "$OLD_GLOBAL_WORKSPACE" "$old_workspace_fingerprint"

stage="fetch-immutable-base-helper"
printf '%s\n' '=== FETCH IMMUTABLE PR170-MERGED HELPER ==='
printf '%s' "$helper_json" | jq -er '.content' | tr -d '\n' | base64 -d > "$ORIGINAL_HELPER" || blocked "helper decode failed"
[ "$(git hash-object "$ORIGINAL_HELPER")" = "$HELPER_BLOB" ] || blocked "decoded helper blob mismatch"

stage="deterministic-r3-transform"
awk -v base="$BASE_MAIN" '
  /^REBIND_BASE=/ {
    print
    print "REBIND_MERGE=\"" base "\""
    next
  }
  /^main_sha=/ {
    sub(/^main_sha=/, "live_main_sha=")
    print
    print "main_sha=\"$REBIND_MERGE\""
    next
  }
  /^old_broker_events=/ {
    print "old_broker_events_status=\"$(sudo -u \"$BROKER_USER\" curl -sS --max-time 5 --unix-socket \"$BROKER_SOCKET\" -X GET -o /dev/null -w \"%{http_code}\" \"http://localhost/v1/docker/events/recent?since=$since_epoch&until=$now_epoch\" || true)\""
    next
  }
  index($0, "old_broker_events") && index($0, "current broker unexpectedly exposes #126 route") {
    print "[ \"$old_broker_events_status\" = 404 ] || blocked \"current broker unexpectedly exposes #126 route\""
    next
  }
  { print }
' "$ORIGINAL_HELPER" > "$PATCHED_HELPER" || blocked "R3 helper transform failed"

[ "$(grep -cF "REBIND_MERGE=\"$BASE_MAIN\"" "$PATCHED_HELPER")" -eq 1 ] || blocked "R3 merge pin transform count mismatch"
[ "$(grep -cF 'live_main_sha=' "$PATCHED_HELPER")" -eq 1 ] || blocked "R3 live-main capture transform count mismatch"
[ "$(grep -cF 'main_sha="$REBIND_MERGE"' "$PATCHED_HELPER")" -eq 1 ] || blocked "R3 historical-main pin transform count mismatch"
[ "$(grep -cF 'old_broker_events_status=' "$PATCHED_HELPER")" -eq 1 ] || blocked "R3 status-only broker probe transform count mismatch"
! grep -qF 'old_broker_events="$(unix_response' "$PATCHED_HELPER" || blocked "binary broker-events body capture still present"
bash -n "$PATCHED_HELPER" || blocked "patched helper Bash syntax invalid"
chmod 700 "$ORIGINAL_HELPER" "$PATCHED_HELPER"
printf 'ISSUE126_R3_TRANSFORM_PASS helper_blob=%s historical_main=%s binary_body_capture=absent isolated_home=%s\n' \
  "$HELPER_BLOB" "$BASE_MAIN" "$ISOLATED_HOME"

stage="pre-execution-main-recheck"
main_recheck="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/branches/main" | jq -er '.commit.sha')" || blocked "GitHub main recheck failed"
[ "$main_recheck" = "$main_sha" ] || blocked "GitHub main moved before helper execution"

stage="preparation-only-helper"
printf '%s\n' '=== RUN DETERMINISTICALLY PATCHED PREPARATION-ONLY HELPER ONCE ==='
set +e
env HOME="$ISOLATED_HOME" USER="andris" LOGNAME="andris" bash "$PATCHED_HELPER" 2>&1 | tee "$HELPER_LOG"
helper_rc=${PIPESTATUS[0]}
set -e
printf 'ISSUE126_HELPER_EXIT=%s\n' "$helper_rc"
[ "$helper_rc" -eq 0 ] || blocked "helper BLOCKED/failed; preserve $RUN_ROOT and old global workspace; no cleanup/retry/rollback"

stage="post-execution-reproof"
main_after="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/branches/main" | jq -er '.commit.sha')" || blocked "GitHub main post-check failed"
[ "$main_after" = "$main_sha" ] || blocked "GitHub main moved during helper execution"
if [ "$old_workspace_fingerprint" != absent ]; then
  [ "$(stat -Lc '%d:%i:%s:%Y' "$OLD_GLOBAL_WORKSPACE")" = "$old_workspace_fingerprint" ] || blocked "old global workspace metadata changed during R3"
else
  [ ! -e "$OLD_GLOBAL_WORKSPACE" ] || blocked "old global workspace appeared during R3"
fi

printf 'ISSUE126_R3_WRAPPER_PASS live_main=%s run_root=%s helper_log=%s candidate_workspace=%s old_global_workspace_preserved=%s\n' \
  "$main_sha" "$RUN_ROOT" "$HELPER_LOG" "$ISOLATED_HOME/.cache/dashboard-rpi5-candidate-prep/${TARGET}-issue126" "$OLD_GLOBAL_WORKSPACE"
printf 'ISSUE126_R3_STOP production_mutation=NO release_apply=NO systemd_mutation=NO identity_mutation=NO permission_mutation=NO cloudflare_mutation=NO service_restart=NO actions_mutation=NO auto_retry=NO auto_cleanup=NO\n'
