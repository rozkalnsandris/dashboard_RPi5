import {
  parseLogSnapshot,
  parseLogSourcesSnapshot,
  type LogRange,
  type LogSnapshot,
  type LogSourceId,
  type LogSourcesSnapshot,
} from "@dashboard-rpi5/contracts/logs";

export async function fetchLogSources(signal?: AbortSignal): Promise<LogSourcesSnapshot> {
  const response = await fetch("/api/logs/sources", {
    method: "GET",
    headers: { Accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error("Log sources unavailable");
  return parseLogSourcesSnapshot(await response.json());
}

export async function fetchLogs(
  sourceId: LogSourceId,
  range: LogRange,
  signal?: AbortSignal,
): Promise<LogSnapshot> {
  const query = new URLSearchParams({ sourceId, range }).toString();
  const response = await fetch(`/api/logs?${query}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error("Logs unavailable");
  return parseLogSnapshot(await response.json());
}
