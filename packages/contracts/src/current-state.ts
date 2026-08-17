import { FormatRegistry, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import {
  DockerContainersSnapshotSchema,
  HostSummarySchema,
  type DockerContainersSnapshot,
  type HostSummary,
} from "./index.js";

FormatRegistry.Set("date-time", (value) => Number.isFinite(Date.parse(value)));

export const CurrentStateApiErrorSchema = Type.Object(
  {
    error: Type.Literal("SOURCE_UNAVAILABLE"),
  },
  { additionalProperties: false },
);

export function parseHostSummary(value: unknown): HostSummary {
  if (!Value.Check(HostSummarySchema, value)) {
    throw new Error("Invalid host summary response");
  }
  return value as HostSummary;
}

export function parseDockerContainersSnapshot(value: unknown): DockerContainersSnapshot {
  if (!Value.Check(DockerContainersSnapshotSchema, value)) {
    throw new Error("Invalid Docker containers response");
  }
  return value as DockerContainersSnapshot;
}
