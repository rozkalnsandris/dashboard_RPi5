import { describe, expect, it } from "vitest";

import {
  DOCKER_BROKER_CONTAINERS_PATH,
  DOCKER_BROKER_EVENTS_MAX_WINDOW_SECONDS,
  DOCKER_BROKER_HEALTH_PATH,
  DOCKER_BROKER_MAX_REQUEST_URL_BYTES,
  DOCKER_BROKER_PING_PATH,
  DOCKER_BROKER_VERSION_PATH,
  dockerBrokerEventsPath,
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
    expect(parseDockerBrokerRoute(dockerBrokerEventsPath(100, 200))).toEqual({
      kind: "events",
      since: 100,
      until: 200,
    });
  });

  it("keeps Docker events to one canonical bounded window with no caller filters", () => {
    const maxUntil = 100 + DOCKER_BROKER_EVENTS_MAX_WINDOW_SECONDS;
    expect(parseDockerBrokerRoute(dockerBrokerEventsPath(100, maxUntil))).toEqual({
      kind: "events",
      since: 100,
      until: maxUntil,
    });
    expect(() => dockerBrokerEventsPath(100, maxUntil + 1)).toThrow();
    expect(() => dockerBrokerEventsPath(201, 200)).toThrow();

    for (const path of [
      "/v1/docker/events/recent",
      "/v1/docker/events/recent?since=100",
      "/v1/docker/events/recent?until=200&since=100",
      "/v1/docker/events/recent?since=100&until=200&filters=%7B%7D",
      "/v1/docker/events/recent?since=100&since=101&until=200",
      "/v1/docker/events/recent?since=0100&until=200",
      `/v1/docker/events/recent?since=100&until=${maxUntil + 1}`,
    ]) {
      expect(parseDockerBrokerRoute(path), path).toBeNull();
    }
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
      "/v1/docker/events?since=1&until=2",
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
