import {
  PROMETHEUS_DEFAULT_BASE_URL,
  PROMETHEUS_MAX_RESPONSE_BYTES,
  PROMETHEUS_QUERY_RANGE_PATH,
  PROMETHEUS_QUERY_TIMEOUT,
  PROMETHEUS_REQUEST_TIMEOUT_MS,
  PrometheusSourceUnavailableError,
  type PrometheusQueryRangeRequest,
  type PrometheusTransport,
} from "./prometheus-types.js";

export function parsePrometheusBaseUrl(raw: string): URL {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new PrometheusSourceUnavailableError();
    }
    if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
      throw new PrometheusSourceUnavailableError();
    }
    if (url.pathname !== "/") throw new PrometheusSourceUnavailableError();
    return url;
  } catch (error: unknown) {
    if (error instanceof PrometheusSourceUnavailableError) throw error;
    throw new PrometheusSourceUnavailableError();
  }
}

export function buildPrometheusQueryRangeUrl(
  baseUrl: URL,
  request: PrometheusQueryRangeRequest,
): URL {
  if (
    request.query.length === 0 ||
    request.query.length > 4_096 ||
    !Number.isSafeInteger(request.startEpochSeconds) ||
    !Number.isSafeInteger(request.endEpochSeconds) ||
    !Number.isSafeInteger(request.stepSeconds) ||
    request.startEpochSeconds < 0 ||
    request.endEpochSeconds < request.startEpochSeconds ||
    request.stepSeconds <= 0
  ) {
    throw new PrometheusSourceUnavailableError();
  }

  const url = new URL(PROMETHEUS_QUERY_RANGE_PATH, baseUrl);
  url.searchParams.set("query", request.query);
  url.searchParams.set("start", String(request.startEpochSeconds));
  url.searchParams.set("end", String(request.endEpochSeconds));
  url.searchParams.set("step", `${request.stepSeconds}s`);
  url.searchParams.set("timeout", PROMETHEUS_QUERY_TIMEOUT);
  url.searchParams.set("limit", "1");
  return url;
}

async function readBoundedResponseBody(response: Response): Promise<string> {
  if (response.body === null) throw new PrometheusSourceUnavailableError();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > PROMETHEUS_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new PrometheusSourceUnavailableError();
      }
      chunks.push(result.value);
    }
  } catch (error: unknown) {
    if (error instanceof PrometheusSourceUnavailableError) throw error;
    throw new PrometheusSourceUnavailableError();
  }

  if (chunks.length === 0) throw new PrometheusSourceUnavailableError();
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export function createPrometheusHttpTransport(
  rawBaseUrl = PROMETHEUS_DEFAULT_BASE_URL,
): PrometheusTransport {
  const baseUrl = parsePrometheusBaseUrl(rawBaseUrl);

  return {
    async read(request, signal) {
      const url = buildPrometheusQueryRangeUrl(baseUrl, request);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PROMETHEUS_REQUEST_TIMEOUT_MS);
      const abortFromCaller = () => controller.abort();
      signal?.addEventListener("abort", abortFromCaller, { once: true });

      try {
        signal?.throwIfAborted();
        const response = await fetch(url, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: controller.signal,
          redirect: "error",
        });
        if (!response.ok) throw new PrometheusSourceUnavailableError();

        const body = await readBoundedResponseBody(response);
        try {
          return JSON.parse(body) as unknown;
        } catch {
          throw new PrometheusSourceUnavailableError();
        }
      } catch (error: unknown) {
        if (error instanceof PrometheusSourceUnavailableError) throw error;
        throw new PrometheusSourceUnavailableError();
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abortFromCaller);
      }
    },
  };
}
