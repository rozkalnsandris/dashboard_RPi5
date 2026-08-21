#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

MAIN="db6c4383b33dd9902094c54afd60e51a161f8f4c"
MAIN_TREE="1a457416331357c54e9dae278769a4ef3690bd7c"
MAIN_PARENT="4fd40cd0cc639bad84463b9680e627f8e02157e2"
PR170="170"
PR170_HEAD="514a6405d2bbd66938e4a85eec722d172e2efd93"
HELPER_PATH="tools/operator/issue126-production-candidate-prep.sh"
HELPER_BLOB="3541750f511289056c4a4b8d684db139b9c903eb"
TARGET="a39fc7a9873eedb58cfa49568f9b2e05483cf7c2"
REPO_SLUG="rozkalnsandris/dashboard_RPi5"
ORIGINAL_HOME="$HOME"
RUN_ROOT="$ORIGINAL_HOME/.cache/dashboard-rpi5-operator/issue126-${MAIN}-r3"
ISOLATED_HOME="$RUN_ROOT/home"
HELPER="$RUN_ROOT/issue126-production-candidate-prep.sh"
HELPER_LOG="$RUN_ROOT/helper-output.log"
OLD_GLOBAL_WORKSPACE="$ORIGINAL_HOME/.cache/dashboard-rpi5-candidate-prep/${TARGET}-issue126"

blocked() {
  echo "BLOCKED: $*" >&2
  exit 1
}

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

mkdir -p "$ORIGINAL_HOME/.cache/dashboard-rpi5-operator"
[ ! -e "$RUN_ROOT" ] || blocked "one-shot run directory already exists: $RUN_ROOT"
mkdir "$RUN_ROOT"
mkdir "$ISOLATED_HOME"

printf 'ISSUE126_R3_WRAPPER_START model=%s main=%s run_root=%s isolated_home=%s\n' \
  "$MODEL" "$MAIN" "$RUN_ROOT" "$ISOLATED_HOME"
if [ -e "$OLD_GLOBAL_WORKSPACE" ]; then
  printf 'OLD_GLOBAL_WORKSPACE_PRESERVED=%s\n' "$OLD_GLOBAL_WORKSPACE"
else
  printf 'OLD_GLOBAL_WORKSPACE_PRESERVED=%s status=absent\n' "$OLD_GLOBAL_WORKSPACE"
fi

printf '%s\n' '=== IMMUTABLE GITHUB GATE ==='
main_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/branches/main")" || blocked "GitHub main lookup failed"
[ "$(printf '%s' "$main_json" | jq -er '.commit.sha')" = "$MAIN" ] || blocked "main moved"
[ "$(printf '%s' "$main_json" | jq -er '.commit.commit.tree.sha')" = "$MAIN_TREE" ] || blocked "main tree drift"
[ "$(printf '%s' "$main_json" | jq -er '.commit.commit.verification.verified')" = true ] || blocked "main signature is not verified"
[ "$(printf '%s' "$main_json" | jq -er '.commit.parents | length')" -eq 1 ] || blocked "main parent count drift"
[ "$(printf '%s' "$main_json" | jq -er '.commit.parents[0].sha')" = "$MAIN_PARENT" ] || blocked "main parent drift"

pr_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/pulls/$PR170")" || blocked "PR170 lookup failed"
[ "$(printf '%s' "$pr_json" | jq -er '.merged')" = true ] || blocked "PR170 not merged"
[ "$(printf '%s' "$pr_json" | jq -er '.head.sha')" = "$PR170_HEAD" ] || blocked "PR170 head drift"
[ "$(printf '%s' "$pr_json" | jq -er '.merge_commit_sha')" = "$MAIN" ] || blocked "PR170 merge drift"

printf '%s\n' '=== FETCH IMMUTABLE MERGED HELPER ==='
helper_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/contents/$HELPER_PATH?ref=$MAIN")" || blocked "helper lookup failed"
[ "$(printf '%s' "$helper_json" | jq -er '.sha')" = "$HELPER_BLOB" ] || blocked "helper blob drift"
printf '%s' "$helper_json" | jq -er '.content' | tr -d '\n' | base64 -d > "$HELPER" || blocked "helper decode failed"
chmod 700 "$HELPER"

printf 'ISSUE126_R3_WRAPPER_GATE_PASS main=%s tree=%s parent=%s pr170_head=%s helper_blob=%s\n' \
  "$MAIN" "$MAIN_TREE" "$MAIN_PARENT" "$PR170_HEAD" "$HELPER_BLOB"
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
