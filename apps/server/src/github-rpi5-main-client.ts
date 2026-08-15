const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_REPOSITORY_PATH = "/repos/rozkalnsandris/RPi5_main";
const GITHUB_API_VERSION = "2026-03-10";
const GITHUB_TIMEOUT_MS = 3_000;
const GITHUB_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const GITHUB_CACHE_TTL_MS = 5 * 60 * 1_000;
const GITHUB_COMPARE_FILE_CAP = 300;

const SHORT_SHA = /^[0-9a-f]{12}$/;
const FULL_SHA = /^[0-9a-f]{40}$/;

export type GithubRpi5Relation = "IN_SYNC" | "AHEAD" | "DIVERGED";

export interface GithubRpi5Comparison {
  mainSha: string;
  productionSha: string;
  relation: GithubRpi5Relation;
  aheadBy: number | null;
  changedFiles: string[];
}

export type GithubRpi5MainReader = (
  productionCommit: string,
) => Promise<GithubRpi5Comparison>;

interface GithubRpi5MainReaderOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  cacheTtlMs?: number;
}

export class GithubRpi5SourceUnavailableError extends Error {
  constructor() {
    super("GitHub RPi5 main source unavailable");
    this.name = "GithubRpi5SourceUnavailableError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFullSha(value: unknown): string {
  if (typeof value !== "string" || !FULL_SHA.test(value)) {
    throw new GithubRpi5SourceUnavailableError();
  }
  return value;
}

function parseNonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new GithubRpi5SourceUnavailableError();
  }
  return Number(value);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.ok || response.body === null) {
    throw new GithubRpi5SourceUnavailableError();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > GITHUB_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new GithubRpi5SourceUnavailableError();
      }
      chunks.push(result.value);
    }
  } catch (error) {
    if (error instanceof GithubRpi5SourceUnavailableError) throw error;
    throw new GithubRpi5SourceUnavailableError();
  }
  if (chunks.length === 0) throw new GithubRpi5SourceUnavailableError();
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")) as unknown;
  } catch {
    throw new GithubRpi5SourceUnavailableError();
  }
}

function fixedUrl(path: string): URL {
  const url = new URL(path, GITHUB_API_ORIGIN);
  if (url.origin !== GITHUB_API_ORIGIN || !url.pathname.startsWith(`${GITHUB_REPOSITORY_PATH}/`)) {
    throw new GithubRpi5SourceUnavailableError();
  }
  return url;
}

async function requestJson(fetchImpl: typeof fetch, url: URL): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "dashboard-rpi5/phase6c",
        "x-github-api-version": GITHUB_API_VERSION,
      },
      redirect: "error",
      signal: controller.signal,
    });
    return await readBoundedJson(response);
  } catch (error) {
    if (error instanceof GithubRpi5SourceUnavailableError) throw error;
    throw new GithubRpi5SourceUnavailableError();
  } finally {
    clearTimeout(timeout);
  }
}

function parseBranchSha(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.commit)) {
    throw new GithubRpi5SourceUnavailableError();
  }
  return parseFullSha(value.commit.sha);
}

function parseCommitSha(value: unknown, productionCommit: string): string {
  if (!isRecord(value)) throw new GithubRpi5SourceUnavailableError();
  const sha = parseFullSha(value.sha);
  if (!sha.startsWith(productionCommit)) throw new GithubRpi5SourceUnavailableError();
  return sha;
}

function parseCompare(value: unknown): {
  relation: GithubRpi5Relation;
  aheadBy: number | null;
  changedFiles: string[];
} {
  if (!isRecord(value)) throw new GithubRpi5SourceUnavailableError();
  const status = value.status;
  const aheadBy = parseNonNegativeInteger(value.ahead_by);
  const behindBy = parseNonNegativeInteger(value.behind_by);
  if (!Array.isArray(value.files) || value.files.length >= GITHUB_COMPARE_FILE_CAP) {
    throw new GithubRpi5SourceUnavailableError();
  }

  const changedFiles: string[] = [];
  for (const file of value.files) {
    if (!isRecord(file) || typeof file.filename !== "string" || file.filename.length === 0) {
      throw new GithubRpi5SourceUnavailableError();
    }
    changedFiles.push(file.filename);
    if (file.previous_filename !== undefined) {
      if (typeof file.previous_filename !== "string" || file.previous_filename.length === 0) {
        throw new GithubRpi5SourceUnavailableError();
      }
      changedFiles.push(file.previous_filename);
    }
  }
  const uniqueFiles = [...new Set(changedFiles)].sort();

  if (status === "identical" && aheadBy === 0 && behindBy === 0) {
    return { relation: "IN_SYNC", aheadBy: 0, changedFiles: [] };
  }
  if (status === "ahead" && aheadBy > 0 && behindBy === 0) {
    return { relation: "AHEAD", aheadBy, changedFiles: uniqueFiles };
  }
  if (["behind", "diverged"].includes(String(status))) {
    return { relation: "DIVERGED", aheadBy: null, changedFiles: [] };
  }
  throw new GithubRpi5SourceUnavailableError();
}

export function createGithubRpi5MainReader(
  options: GithubRpi5MainReaderOptions = {},
): GithubRpi5MainReader {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? GITHUB_CACHE_TTL_MS;
  if (!Number.isSafeInteger(cacheTtlMs) || cacheTtlMs < 1_000 || cacheTtlMs > 60 * 60 * 1_000) {
    throw new GithubRpi5SourceUnavailableError();
  }

  let cache: { key: string; expiresAt: number; value: GithubRpi5Comparison } | null = null;

  return async (productionCommit) => {
    if (!SHORT_SHA.test(productionCommit)) throw new GithubRpi5SourceUnavailableError();
    const currentTime = now();
    if (!Number.isFinite(currentTime)) throw new GithubRpi5SourceUnavailableError();
    if (cache !== null && cache.key === productionCommit && currentTime < cache.expiresAt) {
      return cache.value;
    }

    const branchValue = await requestJson(
      fetchImpl,
      fixedUrl(`${GITHUB_REPOSITORY_PATH}/branches/main`),
    );
    const mainSha = parseBranchSha(branchValue);
    const commitValue = await requestJson(
      fetchImpl,
      fixedUrl(`${GITHUB_REPOSITORY_PATH}/commits/${productionCommit}`),
    );
    const productionSha = parseCommitSha(commitValue, productionCommit);

    let value: GithubRpi5Comparison;
    if (productionSha === mainSha) {
      value = {
        mainSha,
        productionSha,
        relation: "IN_SYNC",
        aheadBy: 0,
        changedFiles: [],
      };
    } else {
      const compareUrl = fixedUrl(
        `${GITHUB_REPOSITORY_PATH}/compare/${productionSha}...${mainSha}`,
      );
      compareUrl.searchParams.set("per_page", "1");
      compareUrl.searchParams.set("page", "1");
      const comparison = parseCompare(await requestJson(fetchImpl, compareUrl));
      value = { mainSha, productionSha, ...comparison };
    }

    cache = { key: productionCommit, expiresAt: currentTime + cacheTtlMs, value };
    return value;
  };
}
