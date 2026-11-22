import assert from "node:assert/strict";

import { ACCEPTED_HOST_IMPORT_DESIGN } from "./native-artifact-host-import-design.mjs";

const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_SINGLE_PAGE = 99;

function positiveId(value, label) {
  assert.ok(Number.isSafeInteger(value) && value > 0, label + " must be a positive integer");
  return value;
}

function completePage(page, key) {
  assert.ok(page && typeof page === "object" && !Array.isArray(page),
    key + " API page is required");
  assert.ok(Number.isSafeInteger(page.total_count) &&
    page.total_count >= 0 && page.total_count <= MAX_SINGLE_PAGE,
    key + " pagination cannot be proven complete");
  assert.ok(Array.isArray(page[key]) && page[key].length === page.total_count,
    key + " first page is partial or inconsistent");
  return page[key];
}

/**
 * Projects real GitHub REST run/jobs/artifact response shapes into the accepted
 * source-only byte-verifier input. Caller MUST independently authenticate each
 * API response and prove it belongs to one fresh, exact repository/run snapshot.
 * This function performs no network operation and never grants LIVE authority.
 */
export function projectNativeArtifactGitHubApi({
  repository, expectedMainSha, observedAt, workflowRun, jobsPage, artifactsPage,
}) {
  const policy = ACCEPTED_HOST_IMPORT_DESIGN;
  assert.ok(repository && typeof repository === "object");
  assert.equal(repository.full_name, policy.repository);
  positiveId(repository.id, "repository id");
  assert.match(expectedMainSha ?? "", SHA, "exact current main SHA required");
  assert.ok(typeof observedAt === "string", "observation timestamp required");

  const run = workflowRun;
  assert.ok(run && typeof run === "object", "GitHub workflow run required");
  positiveId(run.id, "run id");
  positiveId(run.run_attempt, "run attempt");
  assert.equal(run.repository?.id, repository.id, "run repository id mismatch");
  assert.equal(run.repository?.full_name, repository.full_name, "run repository mismatch");
  assert.equal(run.head_repository?.id, repository.id, "head repository id mismatch");
  assert.equal(run.name, policy.provenance.workflowName, "workflow name mismatch");
  assert.equal(run.path, policy.provenance.workflow, "workflow path mismatch");
  assert.equal(run.event, "push", "PR or dispatch run is forbidden");
  assert.equal(run.head_branch, "main", "source branch mismatch");
  assert.equal(run.head_sha, expectedMainSha, "source is not exact current main");
  assert.equal(run.status, "completed", "workflow is not complete");
  assert.equal(run.conclusion, "success", "workflow did not succeed");

  const jobs = completePage(jobsPage, "jobs");
  assert.ok(jobs.length > 0, "run has no jobs");
  const ids = new Set();
  for (const job of jobs) {
    positiveId(job.id, "job id");
    assert.ok(!ids.has(job.id), "duplicate GitHub job id");
    ids.add(job.id);
    assert.equal(job.run_id, run.id, "job belongs to another run");
    assert.equal(job.run_attempt, run.run_attempt, "job is from another attempt");
    assert.equal(job.head_sha, run.head_sha, "job head SHA mismatch");
    assert.equal(job.workflow_name, run.name, "job belongs to another workflow");
    assert.equal(job.status, "completed", "run has an incomplete job");
    assert.ok(job.conclusion === "success" || job.conclusion === "skipped",
      "failed or cancelled job in successful run");
  }
  const requireSuccess = name => {
    const matches = jobs.filter(job => job.name === name);
    assert.equal(matches.length, 1, "required GitHub job absent or ambiguous: " + name);
    assert.equal(matches[0].conclusion, "success", "required GitHub job failed: " + name);
    return matches[0].conclusion;
  };
  const nativeJobConclusion = requireSuccess(policy.provenance.nativeJob);
  const mergeGateConclusion = requireSuccess(policy.provenance.mergeGate);

  const artifacts = completePage(artifactsPage, "artifacts");
  const artifactName = policy.provenance.artifactPrefix + expectedMainSha;
  const matches = artifacts.filter(artifact => artifact.name === artifactName);
  assert.equal(matches.length, 1, "required artifact absent or ambiguous");
  const artifact = matches[0];
  positiveId(artifact.id, "artifact id");
  assert.match(artifact.digest ?? "", DIGEST, "artifact API transport digest required");
  assert.equal(artifact.expired, false, "artifact expired");
  assert.ok(Number.isSafeInteger(artifact.size_in_bytes) &&
    artifact.size_in_bytes > 0 &&
    artifact.size_in_bytes <= policy.archive.maxArchiveBytes,
  "artifact size exceeds budget");
  const link = artifact.workflow_run;
  assert.ok(link && typeof link === "object", "artifact workflow-run link required");
  assert.equal(link.id, run.id);
  assert.equal(link.repository_id, repository.id);
  assert.equal(link.head_repository_id, repository.id);
  assert.equal(link.head_branch, run.head_branch);
  assert.equal(link.head_sha, run.head_sha);

  return {
    status: "CALLER_PROJECTED_GITHUB_API_NOT_AUTHENTICATED",
    observedAt,
    expectedMainSha,
    run: {
      id: run.id,
      attempt: run.run_attempt,
      repository: run.repository.full_name,
      repositoryId: repository.id,
      headRepositoryId: run.head_repository.id,
      workflow: run.name,
      workflowPath: run.path,
      event: run.event,
      ref: policy.provenance.ref,
      headBranch: run.head_branch,
      headSha: run.head_sha,
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.created_at,
      nativeJobConclusion,
      mergeGateConclusion,
    },
    artifact: {
      id: artifact.id,
      matchingNameCount: matches.length,
      runId: link.id,
      name: artifact.name,
      digest: artifact.digest,
      expired: artifact.expired,
      sizeBytes: artifact.size_in_bytes,
      createdAt: artifact.created_at,
      expiresAt: artifact.expires_at,
      workflowRun: {
        id: link.id,
        repositoryId: link.repository_id,
        headRepositoryId: link.head_repository_id,
        headBranch: link.head_branch,
        headSha: link.head_sha,
      },
    },
    liveMutation: false,
  };
}
