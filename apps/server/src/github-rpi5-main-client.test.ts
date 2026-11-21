import { describe, expect, it, vi } from "vitest";

import {
  createGithubRpi5MainReader,
  GithubRpi5SourceUnavailableError,
} from "./github-rpi5-main-client.js";

const productionShort = "111111111111";
const productionSha = `${productionShort}${"1".repeat(28)}`;
const mainSha = "2222222222222222222222222222222222222222";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GitHub RPi5 main reader", () => {
  it("resolves the short SHA through fixed public routes and caches an in-sync result", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: productionSha } }))
      .mockResolvedValueOnce(jsonResponse({ sha: productionSha }));
    let now = 1_000_000;
    const read = createGithubRpi5MainReader({
      fetchImpl,
      now: () => now,
      cacheTtlMs: 300_000,
    });

    const first = await read(productionShort);
    now += 30_000;
    const second = await read(productionShort);

    expect(first).toEqual({
      mainSha: productionSha,
      productionSha,
      relation: "IN_SYNC",
      aheadBy: 0,
      changedFiles: [],
    });
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      "https://api.github.com/repos/rozkalnsandris/RPi5_main/branches/main",
    );
    expect(String(fetchImpl.mock.calls[1]![0])).toBe(
      `https://api.github.com/repos/rozkalnsandris/RPi5_main/commits/${productionShort}`,
    );
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init).toMatchObject({ method: "GET", redirect: "error" });
      expect(init?.headers).toMatchObject({
        accept: "application/vnd.github+json",
        "user-agent": "dashboard-rpi5/phase6c",
        "x-github-api-version": "2026-03-10",
      });
      expect(JSON.stringify(init?.headers)).not.toMatch(/authorization|token|cookie/i);
    }
  });

  it("resolves the verified short SHA and compares only fixed full SHAs", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: mainSha } }))
      .mockResolvedValueOnce(jsonResponse({ sha: productionSha }))
      .mockResolvedValueOnce(jsonResponse({
        status: "ahead",
        ahead_by: 3,
        behind_by: 0,
        files: [
          { filename: "docs/README.md" },
          { filename: "ops/bin/rpi5-backup" },
          { filename: "ops/bin/rpi5-backup-v2", previous_filename: "ops/bin/rpi5-backup" },
        ],
      }));
    const read = createGithubRpi5MainReader({ fetchImpl, now: () => 1_000_000 });

    await expect(read(productionShort)).resolves.toEqual({
      mainSha,
      productionSha,
      relation: "AHEAD",
      aheadBy: 3,
      changedFiles: ["docs/README.md", "ops/bin/rpi5-backup", "ops/bin/rpi5-backup-v2"],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      "https://api.github.com/repos/rozkalnsandris/RPi5_main/branches/main",
    );
    expect(String(fetchImpl.mock.calls[1]![0])).toBe(
      `https://api.github.com/repos/rozkalnsandris/RPi5_main/commits/${productionShort}`,
    );
    const compareUrl = new URL(String(fetchImpl.mock.calls[2]![0]));
    expect(compareUrl.pathname).toBe(
      `/repos/rozkalnsandris/RPi5_main/compare/${productionSha}...${mainSha}`,
    );
    expect(compareUrl.searchParams.get("per_page")).toBe("1");
    expect(compareUrl.searchParams.get("page")).toBe("1");
  });


  it("uses complete immutable trees when the compare file list reaches 300", async () => {
    const files = Array.from({ length: 300 }, (_, index) => ({ filename: "docs/" + index + ".md" }));
    const unchanged = { path: "ops/bin/rpi5-backup", type: "blob", mode: "100755", sha: "a".repeat(40) };
    const changed = { path: "scripts/rpi5_deploy_lib.py", type: "blob", mode: "100644", sha: "b".repeat(40) };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: mainSha } }))
      .mockResolvedValueOnce(jsonResponse({ sha: productionSha }))
      .mockResolvedValueOnce(jsonResponse({ status: "ahead", ahead_by: 751, behind_by: 0, files }))
      .mockResolvedValueOnce(jsonResponse({ sha: productionSha, truncated: false, tree: [unchanged, changed] }))
      .mockResolvedValueOnce(jsonResponse({
        sha: mainSha,
        truncated: false,
        tree: [unchanged, { ...changed, sha: "c".repeat(40) }],
      }));
    const read = createGithubRpi5MainReader({ fetchImpl, now: () => 1_000_000 });

    await expect(read(productionShort)).resolves.toEqual({
      mainSha,
      productionSha,
      relation: "AHEAD",
      aheadBy: 751,
      changedFiles: ["scripts/rpi5_deploy_lib.py"],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(String(fetchImpl.mock.calls[3]![0])).toBe(
      "https://api.github.com/repos/rozkalnsandris/RPi5_main/git/trees/" + productionSha + "?recursive=1",
    );
    expect(String(fetchImpl.mock.calls[4]![0])).toBe(
      "https://api.github.com/repos/rozkalnsandris/RPi5_main/git/trees/" + mainSha + "?recursive=1",
    );
  });

  it("proves no controlled-deploy impact with complete trees despite a 300-file compare list", async () => {
    const files = Array.from({ length: 300 }, (_, index) => ({ filename: "docs/" + index + ".md" }));
    const unchanged = { path: "ops/deploy/targets.json", type: "blob", mode: "100644", sha: "a".repeat(40) };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: mainSha } }))
      .mockResolvedValueOnce(jsonResponse({ sha: productionSha }))
      .mockResolvedValueOnce(jsonResponse({ status: "ahead", ahead_by: 3, behind_by: 0, files }))
      .mockResolvedValueOnce(jsonResponse({ sha: productionSha, truncated: false, tree: [unchanged] }))
      .mockResolvedValueOnce(jsonResponse({ sha: mainSha, truncated: false, tree: [unchanged] }));
    const read = createGithubRpi5MainReader({ fetchImpl, now: () => 1_000_000 });
    await expect(read(productionShort)).resolves.toMatchObject({
      relation: "AHEAD",
      aheadBy: 3,
      changedFiles: [],
    });
  });

  it("treats a rename away from an allowlisted path as changed on the tree fallback", async () => {
    const files = Array.from({ length: 300 }, (_, index) => ({ filename: "docs/" + index + ".md" }));
    const moved = { path: "scripts/rpi5-deploy", type: "blob", mode: "100644", sha: "a".repeat(40) };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: mainSha } }))
      .mockResolvedValueOnce(jsonResponse({ sha: productionSha }))
      .mockResolvedValueOnce(jsonResponse({ status: "ahead", ahead_by: 3, behind_by: 0, files }))
      .mockResolvedValueOnce(jsonResponse({ sha: productionSha, truncated: false, tree: [moved] }))
      .mockResolvedValueOnce(jsonResponse({
        sha: mainSha,
        truncated: false,
        tree: [{ ...moved, path: "scripts/rpi5-deploy-moved" }],
      }));
    const read = createGithubRpi5MainReader({ fetchImpl, now: () => 1_000_000 });
    await expect(read(productionShort)).resolves.toMatchObject({
      relation: "AHEAD",
      changedFiles: ["scripts/rpi5-deploy"],
    });
  });

  it.each([
    ["truncated", { sha: mainSha, truncated: true, tree: [] }],
    ["wrong SHA", { sha: productionSha, truncated: false, tree: [] }],
    ["missing entries", { sha: mainSha, truncated: false }],
    ["duplicate impact paths", {
      sha: mainSha,
      truncated: false,
      tree: [
        { path: "ops/bin/rpi5-backup", type: "blob", mode: "100755", sha: "a".repeat(40) },
        { path: "ops/bin/rpi5-backup", type: "blob", mode: "100755", sha: "a".repeat(40) },
      ],
    }],
    ["unsafe impact entry", {
      sha: mainSha,
      truncated: false,
      tree: [{ path: "ops/bin/rpi5-backup", type: "tree", mode: "040000", sha: "a".repeat(40) }],
    }],
  ])("fails closed for %s recursive tree evidence", async (_label, invalidTree) => {
    const files = Array.from({ length: 300 }, (_, index) => ({ filename: "docs/" + index + ".md" }));
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: mainSha } }))
      .mockResolvedValueOnce(jsonResponse({ sha: productionSha }))
      .mockResolvedValueOnce(jsonResponse({ status: "ahead", ahead_by: 751, behind_by: 0, files }))
      .mockResolvedValueOnce(jsonResponse({ sha: productionSha, truncated: false, tree: [] }))
      .mockResolvedValueOnce(jsonResponse(invalidTree));
    const read = createGithubRpi5MainReader({ fetchImpl, now: () => 1_000_000 });
    await expect(read(productionShort)).rejects.toBeInstanceOf(GithubRpi5SourceUnavailableError);
  });

  it("returns DIVERGED instead of inventing ancestry", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: mainSha } }))
      .mockResolvedValueOnce(jsonResponse({ sha: productionSha }))
      .mockResolvedValueOnce(jsonResponse({ status: "diverged", ahead_by: 2, behind_by: 1, files: [] }));
    const read = createGithubRpi5MainReader({ fetchImpl, now: () => 1_000_000 });

    await expect(read(productionShort)).resolves.toMatchObject({
      relation: "DIVERGED",
      aheadBy: null,
      changedFiles: [],
    });
  });

  it("rejects non-evidence refs before any network request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const read = createGithubRpi5MainReader({ fetchImpl, now: () => 1_000_000 });
    await expect(read("main")).rejects.toBeInstanceOf(GithubRpi5SourceUnavailableError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
