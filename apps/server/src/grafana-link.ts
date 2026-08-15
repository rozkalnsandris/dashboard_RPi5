import type { HistoryRange } from "@dashboard-rpi5/contracts/history";

const GRAFANA_DASHBOARD_PATH_PATTERN =
  /^\/d\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9._~-]{1,160}$/u;

function parseGrafanaBaseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
      return null;
    }
    if (url.pathname !== "/") return null;
    return url;
  } catch {
    return null;
  }
}

export function buildGrafanaHistoryHref(
  baseUrlRaw: string | undefined,
  dashboardPath: string | undefined,
  range: HistoryRange,
): string | null {
  if (baseUrlRaw === undefined || dashboardPath === undefined) return null;
  if (!GRAFANA_DASHBOARD_PATH_PATTERN.test(dashboardPath)) return null;

  const baseUrl = parseGrafanaBaseUrl(baseUrlRaw);
  if (baseUrl === null) return null;

  const url = new URL(dashboardPath, baseUrl);
  url.searchParams.set("from", `now-${range}`);
  url.searchParams.set("to", "now");
  return url.toString();
}
