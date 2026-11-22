import assert from "node:assert/strict";
import test from "node:test";

import {
  collectNativeArtifactGitHubReadOnlySnapshot,
} from "./native-artifact-github-readonly-snapshot.mjs";

const SHA = "a".repeat(40);
const ID = 12345;
const REPO_ID = 1335047459;
const ROOT = "https://api.github.com/repos/rozkalnsandris/dashboard_RPi5";
const clone = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const repository = { full_name: "rozkalnsandris/dashboard_RPi5", id: REPO_ID };
  const job = (id, name) => ({
    id, name, run_id: ID, run_attempt: 1, head_sha: SHA,
    workflow_name: "CI", status: "completed", conclusion: "success",
  });
  const pages = new Map([
    [ROOT + "/branches/main", { name: "main", commit: { sha: SHA } }],
    [ROOT, repository],
    [ROOT + "/actions/runs/" + ID, {
      id: ID, run_attempt: 1, name: "CI", path: ".github/workflows/ci.yml",
      event: "push", head_branch: "main", head_sha: SHA,
      status: "completed", conclusion: "success",
      created_at: "2026-11-21T11:00:00Z",
      repository: { ...repository }, head_repository: { ...repository },
    }],
    [ROOT + "/actions/runs/" + ID + "/jobs?per_page=100", {
      total_count: 3, jobs: [
        job(1, "FAST-LANE classify"),
        job(2, "Native ARM64 candidate (source only)"),
        job(3, "FAST-LANE Merge Gate"),
      ],
    }],
    [ROOT + "/actions/runs/" + ID + "/artifacts?per_page=100", {
      total_count: 1, artifacts: [{
        id: 100, name: "dashboard-native-arm64-" + SHA,
        digest: "sha256:" + "b".repeat(64),
        size_in_bytes: 1200, expired: false,
        created_at: "2026-11-21T11:05:00Z",
        expires_at: "2026-11-28T11:04:59Z",
        workflow_run: {
          id: ID, repository_id: REPO_ID, head_repository_id: REPO_ID,
          head_branch: "main", head_sha: SHA,
        },
      }],
    }],
  ]);
  return { pages, reads: [] };
}

function collect(f, options = {}) {
  let branchReads = 0;
  return collectNativeArtifactGitHubReadOnlySnapshot({
    getJson: async url => {
      f.reads.push(url);
      assert.ok(f.pages.has(url), "unexpected GitHub path: " + url);
      const data = clone(f.pages.get(url));
      if (url === ROOT + "/branches/main" && ++branchReads === 2 &&
        options.driftAfter) data.commit.sha = "c".repeat(40);
      return data;
    },
    runId: ID, expectedMainSha: SHA,
    observedAt: "2026-11-22T12:00:00Z",
  });
}

test("six canonical sequential read-only GETs bind before/after main and run", async () => {
  const f = fixture();
  const r = await collect(f);
  assert.equal(r.status, "GITHUB_READONLY_SNAPSHOT_PROJECTED_NOT_AUTHENTICATED");
  assert.equal(r.githubApiAuthenticated, false);
  assert.equal(r.hostImportAuthorized, false);
  assert.equal(r.liveMutation, false);
  assert.equal(r.readCount, 6);
  assert.equal(r.projection.run.headSha, SHA);
  assert.equal(r.projection.run.nativeJobConclusion, "success");
  assert.equal(r.projection.run.mergeGateConclusion, "success");
  assert.equal(r.projection.artifact.name, "dashboard-native-arm64-" + SHA);
  assert.deepStrictEqual(f.reads, [
    ROOT + "/branches/main", ROOT,
    ROOT + "/actions/runs/" + ID,
    ROOT + "/actions/runs/" + ID + "/jobs?per_page=100",
    ROOT + "/actions/runs/" + ID + "/artifacts?per_page=100",
    ROOT + "/branches/main",
  ]);
});

for (const [label, edit] of [
  ["stale initial main", f => {
    f.pages.get(ROOT + "/branches/main").commit.sha = "d".repeat(40);
  }],
  ["incorrect branch name", f => {
    f.pages.get(ROOT + "/branches/main").name = "develop";
  }],
  ["foreign repository", f => {
    f.pages.get(ROOT).full_name = "other/repo";
  }],
  ["wrong run", f => {
    f.pages.get(ROOT + "/actions/runs/" + ID).id += 1;
  }],
  ["run from PR", f => {
    f.pages.get(ROOT + "/actions/runs/" + ID).event = "pull_request";
  }],
  ["unfinished main CI", f => {
    f.pages.get(ROOT + "/actions/runs/" + ID).status = "in_progress";
  }],
  ["incomplete jobs page", f => {
    f.pages.get(ROOT + "/actions/runs/" + ID + "/jobs?per_page=100").total_count += 1;
  }],
  ["skipped native job", f => {
    f.pages.get(ROOT + "/actions/runs/" + ID +
      "/jobs?per_page=100").jobs[1].conclusion = "skipped";
  }],
  ["different job attempt", f => {
    f.pages.get(ROOT + "/actions/runs/" + ID +
      "/jobs?per_page=100").jobs[2].run_attempt = 2;
  }],
  ["missing candidate artifact", f => {
    f.pages.get(ROOT + "/actions/runs/" + ID +
      "/artifacts?per_page=100").artifacts[0].name = "wrong";
  }],
  ["wrong artifact run", f => {
    f.pages.get(ROOT + "/actions/runs/" + ID +
      "/artifacts?per_page=100").artifacts[0].workflow_run.id += 1;
  }],
  ["partial artifacts page", f => {
    f.pages.get(ROOT + "/actions/runs/" + ID +
      "/artifacts?per_page=100").total_count += 1;
  }],
  ["missing GitHub transport digest", f => {
    f.pages.get(ROOT + "/actions/runs/" + ID +
      "/artifacts?per_page=100").artifacts[0].digest = "";
  }],
]) {
  test("source-only GitHub snapshot rejects " + label, async () => {
    const f = fixture();
    edit(f);
    await assert.rejects(collect(f));
  });
}

test("main moving between GETs fails closed with exactly six reads", async () => {
  const f = fixture();
  await assert.rejects(collect(f, { driftAfter: true }), /main moved/u);
  assert.equal(f.reads.length, 6);
});

test("read error stops immediately without retry", async () => {
  const f = fixture();
  let attempts = 0;
  await assert.rejects(collectNativeArtifactGitHubReadOnlySnapshot({
    getJson: async () => {
      attempts += 1;
      throw new Error("read failed");
    },
    runId: ID, expectedMainSha: SHA,
    observedAt: "2026-11-22T12:00:00Z",
  }), /read failed/u);
  assert.equal(attempts, 1);
});

test("rejects mutable SHA, invalid ID and noncanonical UTC before any GET", async () => {
  for (const [runId, expectedMainSha, observedAt] of [
    [0, SHA, "2026-11-22T12:00:00Z"],
    [ID, "main", "2026-11-22T12:00:00Z"],
    [ID, SHA, "2026-02-30T00:00:00Z"],
  ]) {
    let count = 0;
    await assert.rejects(collectNativeArtifactGitHubReadOnlySnapshot({
      getJson: async () => { count += 1; return {}; },
      runId, expectedMainSha, observedAt,
    }));
    assert.equal(count, 0);
  }
});
