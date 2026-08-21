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

blocked() {
  echo "BLOCKED: $*" >&2
  exit 1
}

RUN_ROOT="uninitialized"
trap 'rc=$?; if [ "$rc" -ne 0 ]; then echo "ISSUE126_R3_WRAPPER_EXIT=$rc RUN_ROOT=$RUN_ROOT AUTO_RETRY=NO AUTO_CLEANUP=NO PRODUCTION_MUTATION_AUTHORIZATION=NONE" >&2; fi' EXIT

need() { command -v "$1" >/dev/null 2>&1 || blocked "missing command: $1"; }
for c in curl jq base64 mkdir id tr bash tee chmod; do need "$c"; done

[ "$(id -u)" -ne 0 ] || blocked "run as normal operator, not root"
[ "$(id -un)" = "andris" ] || blocked "run as operator andris"
[ "$ORIGINAL_HOME" = "/home/andris" ] || blocked "unexpected operator HOME: $ORIGINAL_HOME"

MODEL="$(tr -d '\000' < /proc/device-tree/model 2>/dev/null || true)"
case "$MODEL" in
  "Raspberry Pi 5 Model B"*) ;;
  *) blocked "not Raspberry Pi 5 Model B: ${MODEL:-unknown}" ;;
esac

printf '%s\n' '=== POST-MERGE IMMUTABLE GITHUB GATE ==='
base_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/commits/$BASE_MAIN")" || blocked "base main lookup failed"
[ "$(printf '%s' "$base_json" | jq -er '.sha')" = "$BASE_MAIN" ] || blocked "base main SHA drift"
[ "$(printf '%s' "$base_json" | jq -er '.commit.tree.sha')" = "$BASE_TREE" ] || blocked "base main tree drift"
[ "$(printf '%s' "$base_json" | jq -er '.commit.verification.verified')" = true ] || blocked "base main signature is not verified"

main_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/branches/main")" || blocked "GitHub main lookup failed"
main_sha="$(printf '%s' "$main_json" | jq -er '.commit.sha')"
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
expected_files='["docs/ISSUE126_ISOLATED_CANDIDATE_PREP_R3.md","package.json","tools/issue126-production-candidate-prep-isolated-wrapper.test.mjs","tools/operator/issue126-production-candidate-prep-isolated-wrapper.sh"]'
actual_files="$(printf '%s' "$compare_json" | jq -c '[.files[].filename] | sort')"
[ "$actual_files" = "$expected_files" ] || blocked "PR172 changed-file boundary drift: $actual_files"

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

RUN_ROOT="$ORIGINAL_HOME/.cache/dashboard-rpi5-operator/issue126-${main_sha}-r3"
ISOLATED_HOME="$RUN_ROOT/home"
HELPER="$RUN_ROOT/issue126-production-candidate-prep.sh"
HELPER_LOG="$RUN_ROOT/helper-output.log"

mkdir -p "$ORIGINAL_HOME/.cache/dashboard-rpi5-operator"
[ ! -e "$RUN_ROOT" ] || blocked "one-shot run directory already exists: $RUN_ROOT"
mkdir "$RUN_ROOT"
mkdir "$ISOLATED_HOME"

printf 'ISSUE126_R3_WRAPPER_START model=%s base=%s live_main=%s pr172_head=%s ci=%s run_root=%s isolated_home=%s\n' \
  "$MODEL" "$BASE_MAIN" "$main_sha" "$wrapper_head" "$run_id" "$RUN_ROOT" "$ISOLATED_HOME"
if [ -e "$OLD_GLOBAL_WORKSPACE" ]; then
  printf 'OLD_GLOBAL_WORKSPACE_PRESERVED=%s\n' "$OLD_GLOBAL_WORKSPACE"
else
  printf 'OLD_GLOBAL_WORKSPACE_PRESERVED=%s status=absent\n' "$OLD_GLOBAL_WORKSPACE"
fi

printf '%s\n' '=== FETCH IMMUTABLE PR170-MERGED HELPER ==='
printf '%s' "$helper_json" | jq -er '.content' | tr -d '\n' | base64 -d > "$HELPER" || blocked "helper decode failed"
chmod 700 "$HELPER"
printf 'ISSUE126_R3_WRAPPER_GATE_PASS base=%s live_main=%s pr172_head=%s ci=%s helper_source=%s helper_blob=%s\n' \
  "$BASE_MAIN" "$main_sha" "$wrapper_head" "$run_id" "$HELPER_SOURCE" "$HELPER_BLOB"
printf 'ISOLATED_CANDIDATE_WORKSPACE=%s/.cache/dashboard-rpi5-candidate-prep/%s-issue126\n' "$ISOLATED_HOME" "$TARGET"
printf '%s\n' '=== RUN PREPARATION-ONLY HELPER ONCE IN ISOLATED HOME ==='

set +e
env HOME="$ISOLATED_HOME" USER="andris" LOGNAME="andris" bash "$HELPER" 2>&1 | tee "$HELPER_LOG"
helper_rc=${PIPESTATUS[0]}
set -e
printf 'ISSUE126_HELPER_EXIT=%s\n' "$helper_rc"
[ "$helper_rc" -eq 0 ] || blocked "helper BLOCKED/failed; preserve $RUN_ROOT and old global workspace; no cleanup/retry/rollback"

printf 'ISSUE126_R3_WRAPPER_PASS run_root=%s helper_log=%s old_global_workspace_preserved=%s PRODUCTION_MUTATION_AUTHORIZATION=NONE\n' \
  "$RUN_ROOT" "$HELPER_LOG" "$OLD_GLOBAL_WORKSPACE"
