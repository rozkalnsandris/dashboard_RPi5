import {
  parseDeploymentStatusSnapshot,
  type DeploymentStatusSnapshot,
} from "@dashboard-rpi5/contracts/deployment-status";

export async function fetchDeploymentStatus(
  signal?: AbortSignal,
): Promise<DeploymentStatusSnapshot> {
  const response = await fetch("/api/deployments", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error("Deployment status unavailable");
  return parseDeploymentStatusSnapshot(await response.json());
}
