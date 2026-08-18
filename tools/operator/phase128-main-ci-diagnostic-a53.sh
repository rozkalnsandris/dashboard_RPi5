#!/usr/bin/env bash
set -Eeuo pipefail

TARGET="a53fb31c33d872ec4b434d5c999d5469e1989f14"
REPO_SLUG="rozkalnsandris/dashboard_RPi5"

blocked() {
  echo "PHASE128_A53_CI_DIAG_BLOCKED: $*" >&2
  exit 1
}

for command_name in curl jq; do
  command -v "$command_name" >/dev/null 2>&1 || blocked "missing command: $command_name"
done

printf 'PHASE128_A53_CI_DIAG_START target=%s\n' "$TARGET"

main_json="$(curl -fsSL \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/branches/main")" \
  || blocked "GitHub main lookup failed"
main_sha="$(printf '%s' "$main_json" | jq -er '.commit.sha')"
[ "$main_sha" = "$TARGET" ] \
  || blocked "main drift expected=$TARGET actual=$main_sha"

runs_json="$(curl -fsSL \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/actions/runs?branch=main&event=push&per_page=100")" \
  || blocked "Actions lookup failed"

matches="$(printf '%s' "$runs_json" | jq -c --arg sha "$TARGET" '
  [.workflow_runs[]
    | select(.name == "CI")
    | select(.event == "push")
    | select(.head_branch == "main")
    | select(.head_sha == $sha)
    | {id,run_number,run_attempt,status,conclusion,created_at,updated_at,html_url}
  ] | sort_by(.run_number, .run_attempt)
')" || blocked "CI parse failed"

count="$(printf '%s' "$matches" | jq -er 'length')"
[ "$count" -gt 0 ] || blocked "no exact push->main CI run found"
printf 'PHASE128_A53_CI_MATCH_COUNT=%s\n' "$count"

printf '%s' "$matches" | jq -c '.[]' | while IFS= read -r run; do
  run_number="$(printf '%s' "$run" | jq -r '.run_number')"
  run_attempt="$(printf '%s' "$run" | jq -r '.run_attempt // 1')"
  run_id="$(printf '%s' "$run" | jq -r '.id')"
  status="$(printf '%s' "$run" | jq -r '.status')"
  conclusion="$(printf '%s' "$run" | jq -r '.conclusion')"
  created="$(printf '%s' "$run" | jq -r '.created_at')"
  updated="$(printf '%s' "$run" | jq -r '.updated_at')"
  printf 'PHASE128_A53_CI_RUN run_number=%s attempt=%s run_id=%s status=%s conclusion=%s created_at=%s updated_at=%s\n' \
    "$run_number" "$run_attempt" "$run_id" "$status" "$conclusion" "$created" "$updated"
done

latest="$(printf '%s' "$matches" | jq -c 'last')"
latest_id="$(printf '%s' "$latest" | jq -er '.id')"
latest_number="$(printf '%s' "$latest" | jq -er '.run_number')"
latest_attempt="$(printf '%s' "$latest" | jq -er '.run_attempt // 1')"
latest_status="$(printf '%s' "$latest" | jq -er '.status')"
latest_conclusion="$(printf '%s' "$latest" | jq -er '.conclusion')"
printf 'PHASE128_A53_CI_LATEST run_number=%s attempt=%s run_id=%s status=%s conclusion=%s\n' \
  "$latest_number" "$latest_attempt" "$latest_id" "$latest_status" "$latest_conclusion"

jobs_json="$(curl -fsSL \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "https://api.github.com/repos/$REPO_SLUG/actions/runs/$latest_id/jobs?per_page=100")" \
  || blocked "latest CI jobs lookup failed"

printf '%s' "$jobs_json" | jq -c '.jobs[] | {id,name,status,conclusion,started_at,completed_at}' | while IFS= read -r job; do
  job_id="$(printf '%s' "$job" | jq -er '.id')"
  name="$(printf '%s' "$job" | jq -er '.name')"
  status="$(printf '%s' "$job" | jq -er '.status')"
  conclusion="$(printf '%s' "$job" | jq -r '.conclusion')"
  printf 'PHASE128_A53_CI_JOB job_id=%s name=%q status=%s conclusion=%s\n' \
    "$job_id" "$name" "$status" "$conclusion"
done

printf 'PHASE128_A53_CI_DIAG_STOP production_mutation=NO github_write=NO\n'
