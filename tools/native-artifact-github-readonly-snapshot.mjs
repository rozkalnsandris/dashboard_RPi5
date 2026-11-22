import assert from "node:assert/strict";

import { projectNativeArtifactGitHubApi } from "./native-artifact-github-api-projection.mjs";

const REPOSITORY_PATH = "/repos/rozkalnsandris/dashboard_RPi5";
const SHA = /^[a-f0-9]{40}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;

/**
 * A six-read, source-only GitHub REST snapshot contract.
 *
 * getJson MUST be supplied by a separately trusted, authenticated READ-ONLY
 * GitHub transport. Its response authenticity is NOT proven here. No token,
 * fetch, download, filesystem access, host import or LIVE operation is present.
 * Every read is sequential, fixed to the canonical repository and single run.
 */
export async function collectNativeArtifactGitHubReadOnlySnapshot({
  getJson, runId, expectedMainSha, observedAt,
}) {
  assert.equal(typeof getJson, "function", "trusted read-only GET provider required");
  assert.ok(Number.isSafeInteger(runId) && runId > 0, "exact run id required");
  assert.match(expectedMainSha ?? "", SHA, "independent exact main SHA required");
  assert.match(observedAt ?? "", UTC, "canonical UTC observation time required");
  const millis = Date.parse(observedAt);
  assert.ok(Number.isFinite(millis) &&
    new Date(millis).toISOString().slice(0, 19) + "Z" === observedAt,
  "invalid observation time");

  let readCount = 0;
  const read = async path => {
    readCount += 1;
    assert.ok(readCount <= 6, "read budget exceeded");
    const value = await getJson("https://api.github.com" + REPOSITORY_PATH + path);
    assert.ok(value !== null && typeof value === "object" &&
      !Array.isArray(value), "GitHub GET response must be an object");
    return value;
  };
  const before = await read("/branches/main");
  assert.equal(before.name, "main", "GitHub branch name mismatch");
  assert.equal(before.commit?.sha, expectedMainSha,
    "stale main before collecting GitHub metadata");

  const repository = await read("");
  const workflowRun = await read("/actions/runs/" + runId);
  const jobsPage = await read("/actions/runs/" + runId + "/jobs?per_page=100");
  const artifactsPage = await read("/actions/runs/" + runId + "/artifacts?per_page=100");
  const after = await read("/branches/main");
  assert.equal(after.name, "main", "final GitHub branch name mismatch");
  assert.equal(after.commit?.sha, expectedMainSha,
    "main moved during GitHub metadata collection");
  assert.equal(readCount, 6);

  const projection = projectNativeArtifactGitHubApi({
    repository, expectedMainSha, observedAt, workflowRun, jobsPage, artifactsPage,
  });
  assert.equal(projection.status, "CALLER_PROJECTED_GITHUB_API_NOT_AUTHENTICATED");
  assert.equal(projection.run.id, runId);

  return {
    status: "GITHUB_READONLY_SNAPSHOT_PROJECTED_NOT_AUTHENTICATED",
    expectedMainSha,
    runId,
    readCount,
    projection,
    githubApiAuthenticated: false,
    hostImportAuthorized: false,
    liveMutation: false,
  };
}
