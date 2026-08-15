import {
  parseSystemdServicesSnapshot,
  type SystemdServicesSnapshot,
} from "@dashboard-rpi5/contracts/services";

export async function fetchSystemdServices(signal?: AbortSignal): Promise<SystemdServicesSnapshot> {
  const response = await fetch("/api/services", {
    method: "GET",
    headers: { Accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error("Services source unavailable");
  return parseSystemdServicesSnapshot(await response.json());
}
