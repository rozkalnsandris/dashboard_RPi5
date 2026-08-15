import {
  parseActivitySnapshot,
  type ActivitySnapshot,
} from "@dashboard-rpi5/contracts/activity";

export async function fetchActivity(signal?: AbortSignal): Promise<ActivitySnapshot> {
  const response = await fetch("/api/activity", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error("Activity unavailable");
  return parseActivitySnapshot(await response.json());
}
