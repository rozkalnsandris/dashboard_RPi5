#!/usr/bin/env bash
set -Eeuo pipefail

TARGET="7f42858ba2760d235ceab05788141cf18a9dff9d"
REPO_SLUG="rozkalnsandris/dashboard_RPi5"

blocked() { echo "PHASE128_CI_DIAG_BLOCKED: $*" >&2; exit 1; }
for c in curl jq git; do command -v "$c" >/dev/null 2>&1 || blocked "missing command: $c"; done

echo "PHASE128_CI_DIAG_START target=$TARGET"

main_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' "https://api.github.com/repos/$REPO_SLUG/branches/main")" || blocked "GitHub main lookup failed"
main_sha="$(printf '%s' "$main_json" | jq -er '.commit.sha')"
[ "$main_sha" = "$TARGET" ] || blocked "main drift expected=$TARGET actual=$main_sha"

runs_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' "https://api.github.com/repos/$REPO_SLUG/actions/runs?branch=main&event=push&per_page=100")" || blocked "Actions lookup failed"

matches="$(printf '%s' "$runs_json" | jq -c --arg sha "$TARGET" '[.workflow_runs[] | select(.name=="CI" and .event=="push" and .head_branch=="main" and .head_sha==$sha) | {id,run_number,status,conclusion,created_at,updated_at,html_url}] | sort_by(.run_number)')" || blocked "CI parse failed"
count="$(printf '%s' "$matches" | jq -r 'length')"
[ "$count" -gt 0 ] || blocked "no exact push->main CI run found"

echo "PHASE128_CI_MATCH_COUNT=$count"
printf '%s' "$matches" | jq -c '.[]' | while IFS= read -r run; do
  id="$(printf '%s' "$run" | jq -r '.id')"
  number="$(printf '%s' "$run" | jq -r '.run_number')"
  status="$(printf '%s' "$run" | jq -r '.status')"
  conclusion="$(printf '%s' "$run" | jq -r '.conclusion')"
  created="$(printf '%s' "$run" | jq -r '.created_at')"
  updated="$(printf '%s' "$run" | jq -r '.updated_at')"
  echo "PHASE128_CI_RUN run_number=$number run_id=$id status=$status conclusion=$conclusion created_at=$created updated_at=$updated"

done

latest="$(printf '%s' "$matches" | jq -c 'last')"
latest_id="$(printf '%s' "$latest" | jq -r '.id')"
latest_number="$(printf '%s' "$latest" | jq -r '.run_number')"
latest_status="$(printf '%s' "$latest" | jq -r '.status')"
latest_conclusion="$(printf '%s' "$latest" | jq -r '.conclusion')"

echo "PHASE128_CI_LATEST run_number=$latest_number run_id=$latest_id status=$latest_status conclusion=$latest_conclusion"

jobs_json="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' "https://api.github.com/repos/$REPO_SLUG/actions/runs/$latest_id/jobs?per_page=100")" || blocked "latest CI jobs lookup failed"
printf '%s' "$jobs_json" | jq -c '.jobs[] | {id,name,status,conclusion,started_at,completed_at}' | while IFS= read -r job; do
  id="$(printf '%s' "$job" | jq -r '.id')"
  name="$(printf '%s' "$job" | jq -r '.name')"
  status="$(printf '%s' "$job" | jq -r '.status')"
  conclusion="$(printf '%s' "$job" | jq -r '.conclusion')"
  echo "PHASE128_CI_JOB job_id=$id name=$(printf '%q' "$name") status=$status conclusion=$conclusion"
done

echo "PHASE128_CI_DIAG_STOP production_mutation=NO github_write=NO"