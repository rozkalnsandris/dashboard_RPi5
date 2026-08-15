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

  it("fails closed when GitHub returns the 300-file comparison boundary", async () => {
    const files = Array.from({ length: 300 }, (_, index) => ({ filename: `docs/${index}.md` }));
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: mainSha } }))
      .mockResolvedValueOnce(jsonResponse({ sha: productionSha }))
      .mockResolvedValueOnce(jsonResponse({ status: "ahead", ahead_by: 1, behind_by: 0, files }));
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
