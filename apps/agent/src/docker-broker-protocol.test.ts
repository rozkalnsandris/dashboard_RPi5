import { describe, expect, it } from "vitest";

import {
  DOCKER_BROKER_CONTAINERS_PATH,
  DOCKER_BROKER_HEALTH_PATH,
  DOCKER_BROKER_MAX_REQUEST_URL_BYTES,
  DOCKER_BROKER_PING_PATH,
  DOCKER_BROKER_VERSION_PATH,
  dockerBrokerInspectPath,
  dockerBrokerStatsPath,
  parseDockerBrokerRoute,
} from "./docker-broker-protocol.js";

const ID = "a".repeat(64);

describe("Docker broker fixed route protocol", () => {
  it("accepts only the exact bounded read capabilities", () => {
    expect(parseDockerBrokerRoute(DOCKER_BROKER_HEALTH_PATH)).toEqual({ kind: "health" });
    expect(parseDockerBrokerRoute(DOCKER_BROKER_PING_PATH)).toEqual({ kind: "ping" });
    expect(parseDockerBrokerRoute(DOCKER_BROKER_VERSION_PATH)).toEqual({ kind: "version" });
    expect(parseDockerBrokerRoute(DOCKER_BROKER_CONTAINERS_PATH)).toEqual({ kind: "containers" });
    expect(parseDockerBrokerRoute(dockerBrokerInspectPath(ID))).toEqual({ kind: "inspect", id: ID });
    expect(parseDockerBrokerRoute(dockerBrokerStatsPath(ID))).toEqual({ kind: "stats", id: ID });
  });

  it("rejects mutation paths, arbitrary Docker paths, queries and traversal", () => {
    for (const path of [
      `/v1/docker/containers/${ID}/stop`,
      `/v1/docker/containers/${ID}/kill`,
      `/v1/docker/containers/${ID}/exec`,
      "/v1/docker/images/json",
      "/v1/docker/containers/../version",
      `${DOCKER_BROKER_CONTAINERS_PATH}?all=false`,
      `${dockerBrokerInspectPath(ID)}?x=1`,
      `/v1/docker/containers/${"A".repeat(64)}/inspect`,
      "/v1/docker/containers/not-an-id/inspect",
      "/v1/docker/events",
    ]) {
      expect(parseDockerBrokerRoute(path), path).toBeNull();
    }
  });

  it("rejects overlong request targets before parsing", () => {
    expect(
      parseDockerBrokerRoute(`/${"a".repeat(DOCKER_BROKER_MAX_REQUEST_URL_BYTES + 1)}`),
    ).toBeNull();
  });

  it("refuses to construct container capabilities from invalid IDs", () => {
    expect(() => dockerBrokerInspectPath("../etc/passwd")).toThrow();
    expect(() => dockerBrokerStatsPath("short")).toThrow();
  });
});
