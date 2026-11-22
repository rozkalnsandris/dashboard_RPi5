import assert from "node:assert/strict";
import test from "node:test";

import { projectNativeArtifactGitHubApi } from "./native-artifact-github-api-projection.mjs";

const SHA = "a".repeat(40);
const repoId = 1335047459;
const runId = 45017053682;

function sample() {
  const repository = { id: repoId, full_name: "rozkalnsandris/dashboard_RPi5" };
  const job = (id, name, conclusion = "success") => ({
    id, name, run_id: runId, run_attempt: 1, head_sha: SHA,
    workflow_name: "CI", status: "completed", conclusion,
  });
  return {
    repository,
    expectedMainSha: SHA,
    observedAt: "2026-11-22T12:00:00Z",
    workflowRun: {
      id: runId, run_attempt: 1, name: "CI", path: ".github/workflows/ci.yml",
      head_sha: SHA, head_branch: "main", event: "push",
      status: "completed", conclusion: "success",
      created_at: "2026-11-22T11:23:03Z",
      repository: { ...repository }, head_repository: { ...repository },
    },
    jobsPage: {
      total_count: 3, jobs: [
        job(11, "FAST-LANE classify"),
        job(12, "Native ARM64 candidate (source only)"),
        job(13, "FAST-LANE Merge Gate"),
      ],
    },
    artifactsPage: {
      total_count: 1, artifacts: [{
        id: 14752093142, name: "dashboard-native-arm64-" + SHA,
        size_in_bytes: 1433609, digest: "sha256:" + "b".repeat(64),
        expired: false, created_at: "2026-11-22T11:24:57Z",
        expires_at: "2026-11-29T11:24:55Z",
        workflow_run: {
          id: runId, repository_id: repoId, head_repository_id: repoId,
          head_branch: "main", head_sha: SHA,
        },
      }],
    },
  };
}
const clone = value => JSON.parse(JSON.stringify(value));

test("raw GitHub API shapes project into a non-authoritative verifier envelope", () => {
  const result = projectNativeArtifactGitHubApi(sample());
  assert.equal(result.status, "CALLER_PROJECTED_GITHUB_API_NOT_AUTHENTICATED");
  assert.equal(result.liveMutation, false);
  assert.equal(result.expectedMainSha, SHA);
  assert.equal(result.run.id, runId);
  assert.equal(result.run.ref, "refs/heads/main");
  assert.equal(result.run.nativeJobConclusion, "success");
  assert.equal(result.run.mergeGateConclusion, "success");
  assert.equal(result.artifact.runId, runId);
  assert.equal(result.artifact.workflowRun.repositoryId, repoId);
  assert.equal(result.artifact.matchingNameCount, 1);
  assert.equal(result.artifact.sizeBytes, 1433609);
});

for (const [reason, change] of [
  ["wrong repository", x => { x.repository.full_name = "somewhere/else"; }],
  ["run from other repository", x => { x.workflowRun.repository.id += 1; }],
  ["forked head", x => { x.workflowRun.head_repository.id += 1; }],
  ["stale main", x => { x.expectedMainSha = "c".repeat(40); }],
  ["wrong workflow path", x => { x.workflowRun.path = ".github/workflows/fake.yml"; }],
  ["PR trigger", x => { x.workflowRun.event = "pull_request"; }],
  ["wrong branch", x => { x.workflowRun.head_branch = "other"; }],
  ["unfinished run", x => { x.workflowRun.status = "in_progress"; }],
  ["failed run", x => { x.workflowRun.conclusion = "failure"; }],
  ["partial jobs response", x => { x.jobsPage.total_count = 4; }],
  ["jobs pagination at 100", x => { x.jobsPage.total_count = 100; }],
  ["missing native job", x => { x.jobsPage.jobs[1].name = "missing"; }],
  ["failed native job", x => { x.jobsPage.jobs[1].conclusion = "failure"; }],
  ["missing merge gate", x => { x.jobsPage.jobs[2].name = "missing"; }],
  ["skipped merge gate", x => { x.jobsPage.jobs[2].conclusion = "skipped"; }],
  ["job belongs to another run", x => { x.jobsPage.jobs[1].run_id = 123; }],
  ["old job attempt", x => { x.jobsPage.jobs[1].run_attempt = 2; }],
  ["duplicate job id", x => { x.jobsPage.jobs[1].id = 11; }],
  ["partial artifacts list", x => { x.artifactsPage.total_count = 2; }],
  ["missing named artifact", x => { x.artifactsPage.artifacts[0].name = "wrong"; }],
  ["duplicate matching artifact", x => {
    x.artifactsPage.artifacts.push(clone(x.artifactsPage.artifacts[0]));
    x.artifactsPage.total_count = 2;
  }],
  ["expired artifact", x => { x.artifactsPage.artifacts[0].expired = true; }],
  ["no API digest", x => { x.artifactsPage.artifacts[0].digest = "bad"; }],
  ["wrong artifact run", x => { x.artifactsPage.artifacts[0].workflow_run.id += 1; }],
  ["wrong artifact head", x => { x.artifactsPage.artifacts[0].workflow_run.head_sha = "d".repeat(40); }],
  ["unexpected large artifact", x => { x.artifactsPage.artifacts[0].size_in_bytes = 100000000; }],
]) {
  test("GitHub REST source-only projection rejects " + reason, () => {
    const value = sample();
    change(value);
    assert.throws(() => projectNativeArtifactGitHubApi(value));
  });
}
