import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(readFileSync('.github/github-api-access-v1.json', 'utf8'));
const startup = JSON.parse(readFileSync('.github/start-github-only.json', 'utf8'));

const SHARED_REVISION = '3bb0740b5f0a8ce631d2ff79f1acc4999ff6ed2c';

test('pins the accepted GitHub API access contract without widening dashboard authority', () => {
  assert.equal(manifest.schema, 'rozkalns.github-api-access-consumer.v1');
  assert.equal(manifest.repository, 'rozkalnsandris/dashboard_RPi5');
  assert.equal(manifest.canonical.shared_contract_revision, SHARED_REVISION);
  assert.equal(manifest.local_stricter_rules.master_issue_1_remains_authoritative, true);
  assert.equal(manifest.local_stricter_rules.fast_merge_requires_explicit_owner_decision, true);
  assert.equal(manifest.local_stricter_rules.production_deploy_requires_separate_exact_authority, true);
  assert.equal(
    manifest.local_stricter_rules.cloudflare_host_root_docker_systemd_secrets_permissions_require_exact_authority,
    true,
  );
  assert.equal(manifest.mutation_boundary.merge_success_implies_live_or_deploy_authority, false);
});

test('binds START, SYNC and turpini to serial minimum-sufficient reads without tight polling', () => {
  assert.equal(startup.github_api_access.consumer_manifest, '.github/github-api-access-v1.json');
  assert.equal(startup.github_api_access.shared_contract_revision, SHARED_REVISION);
  assert.deepEqual(startup.github_api_access.applies_to, ['START', 'SYNC', 'turpini']);
  assert.equal(startup.github_api_access.serial_by_default, true);
  assert.equal(startup.github_api_access.minimum_sufficient_retrieval, true);
  assert.equal(startup.github_api_access.tight_polling_allowed, false);

  assert.equal(manifest.read_plan.serial_by_default_per_repository_lane, true);
  assert.equal(manifest.read_plan.minimum_sufficient_retrieval_required, true);
  assert.equal(manifest.read_plan.changed_files_on_demand_only, true);
  assert.equal(manifest.read_plan.tight_polling_allowed, false);
});

test('synthetic ambiguous post-dispatch outcomes never permit duplicate mutation', () => {
  const cases = [
    ['post_dispatch_429', 'MUTATION_OUTCOME_UNKNOWN_RATE_LIMIT'],
    ['post_dispatch_timeout', 'MUTATION_OUTCOME_UNKNOWN_TIMEOUT'],
    ['post_dispatch_transport_error', 'MUTATION_OUTCOME_UNKNOWN_TRANSPORT'],
  ];

  assert.equal(manifest.synthetic_acceptance.intentionally_exhaust_real_quota, false);

  for (const [key, disposition] of cases) {
    const outcome = manifest.synthetic_acceptance[key];
    assert.equal(outcome.disposition, disposition);
    assert.equal(outcome.automatic_duplicate_mutation_allowed, false);
    assert.equal(outcome.requires_reconciliation, true);
    assert.equal(outcome.stop, true);
  }
});


const rdcFallback = JSON.parse(readFileSync('.github/github-first-rdc-v1.json', 'utf8'));
const rdcRules = readFileSync('AGENTS.md', 'utf8');
test('pinned GitHub-first policy and existing dashboard authority', () => {
  assert.equal(rdcFallback.schema, 'rozkalns.github-first-rdc-fallback.consumer.v1');
  assert.equal(rdcFallback.repository, 'rozkalnsandris/dashboard_RPi5');
  assert.equal(rdcFallback.canonical_revision, '4e89b75d7f496dfb43fd9c1eb10a995fad53fdd8');
  assert.match(rdcRules, /GitHub-first \/ bounded RDC fallback v1/);
  for (const value of Object.values(rdcFallback.local)) assert.equal(value, true);
});
test('GitHub and Actions outrank bounded host fallback', () => {
  assert.equal(rdcFallback.selection.github_equivalent_mandatory, true);
  assert.equal(rdcFallback.selection.github_actions_when_equivalent, true);
  assert.equal(rdcFallback.selection.rdc_for_convenience, false);
  assert.deepEqual(rdcFallback.rdc_exception.record_fields, ["STEP","REPOSITORY_AND_TARGET","GITHUB_CAPABILITY_CHECKED","PRECISE_CAPABILITY_GAP","GITHUB_CI_NOT_EQUIVALENT_REASON","MINIMAL_RDC_OPERATION","EXISTING_AUTHORIZATION","GITHUB_RETURN_EVIDENCE"]);
  assert.equal(rdcFallback.guardrails.duplicate_rdc_write_forbidden, true);
});
test('routing decision fixtures fail closed', () => {
  const route = ([, github, actions, host, error, authority]) =>
    error ? 'STOP' : github ? 'GITHUB' : actions ? 'GITHUB_ACTIONS' :
    host && authority ? 'RDC_EXCEPTION' : 'STOP';
  for (const item of rdcFallback.decision_cases) assert.equal(route(item), item[6], item[0]);
});
