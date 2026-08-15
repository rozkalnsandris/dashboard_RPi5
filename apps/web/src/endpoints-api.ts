import {
  parsePublicEndpointStatusSnapshot,
  type PublicEndpointStatusSnapshot,
} from "@dashboard-rpi5/contracts/endpoints";

export async function fetchPublicEndpointStatus(signal?: AbortSignal): Promise<PublicEndpointStatusSnapshot> {
  const response = await fetch("/api/endpoints", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error("Public endpoint status unavailable");
  return parsePublicEndpointStatusSnapshot(await response.json());
}
