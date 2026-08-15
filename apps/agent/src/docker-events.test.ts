import { describe, expect, it } from "vitest";

import {
  DOCKER_EVENT_FILTER_ACTIONS,
  DOCKER_EVENTS_LOOKBACK_SECONDS,
  DockerEventStreamDecoder,
  buildDockerEventsPath,
  isAllowedDockerEventsPath,
  normalizeDockerEvent,
  readRecentDockerEvents,
  type DockerEventsTransport,
} from "./docker-events.js";
import { DOCKER_MAX_RESPONSE_BYTES, DockerSourceUnavailableError } from "./docker-read.js";

const CONTAINER_ID = "a".repeat(64);
const SECOND_CONTAINER_ID = "b".repeat(64);

function event(overrides: Record<string, unknown> = {}) {
  return {
    Type: "container",
    Action: "start",
    Actor: {
      ID: CONTAINER_ID,
      Attributes: {
        name: "homeassistant",
        image: "ghcr.io/home-assistant/home-assistant:stable",
      },
    },
    scope: "local",
    time: 1_765_800_000,
    timeNano: 1_765_800_000_123_000_000,
    ...overrides,
  };
}

describe("Docker recent event path boundary", () => {
  it("builds only the fixed v1.40 event route with bounded server-owned filters", () => {
    const path = buildDockerEventsPath(100, 200);
    expect(isAllowedDockerEventsPath(path)).toBe(true);

    const url = new URL(path, "http://docker.local");
    expect(url.pathname).toBe("/v1.40/events");
    expect(url.searchParams.get("since")).toBe("100");
    expect(url.searchParams.get("until")).toBe("200");
    expect(JSON.parse(url.searchParams.get("filters") ?? "{}")).toEqual({
      type: ["container"],
      event: [...DOCKER_EVENT_FILTER_ACTIONS],
    });
  });

  it("rejects altered paths, filters and invalid windows", () => {
    expect(isAllowedDockerEventsPath("/v1.40/containers/json?all=true")).toBe(false);
    expect(
      isAllowedDockerEventsPath(
        "/v1.40/events?since=100&until=200&filters=%7B%22type%22%3A%5B%22image%22%5D%7D",
      ),
    ).toBe(false);
    expect(() => buildDockerEventsPath(201, 200)).toThrow(DockerSourceUnavailableError);
  });
});

describe("Docker event stream decoder", () => {
  it("parses JSON lines correctly when UTF-8 and object boundaries cross chunks", () => {
    const decoder = new DockerEventStreamDecoder();
    const first = JSON.stringify(event());
    const second = JSON.stringify(
      event({
        Action: "stop",
        Actor: { ID: SECOND_CONTAINER_ID, Attributes: { name: "grafana", image: "grafana/grafana" } },
        time: 1_765_800_001,
      }),
    );
    const payload = `${first}\n${second}\n`;
    const buffer = Buffer.from(payload, "utf8");

    decoder.push(buffer.subarray(0, 17));
    decoder.push(buffer.subarray(17, 113));
    decoder.push(buffer.subarray(113));

    expect(decoder.finish()).toHaveLength(2);
  });

  it("rejects malformed and oversized streams", () => {
    const malformed = new DockerEventStreamDecoder();
    malformed.push("{not-json}\n");
    expect(() => malformed.finish()).toThrow(DockerSourceUnavailableError);

    const oversized = new DockerEventStreamDecoder();
    expect(() => oversized.push(Buffer.alloc(DOCKER_MAX_RESPONSE_BYTES + 1))).toThrow(
      DockerSourceUnavailableError,
    );
  });
});

describe("Docker event normalization", () => {
  it("normalizes allowed operational fields without forwarding arbitrary attributes", () => {
    expect(
      normalizeDockerEvent(
        event({
          Action: "die",
          Actor: {
            ID: CONTAINER_ID,
            Attributes: {
              name: "homeassistant",
              image: "ha:stable",
              exitCode: "137",
              secret_label: "must-not-leak",
            },
          },
          scope: "swarm",
        }),
      ),
    ).toEqual({
      occurredAt: "2025-12-15T05:20:00.000Z",
      action: "DIE",
      containerId: CONTAINER_ID,
      containerName: "homeassistant",
      image: "ha:stable",
      health: null,
      exitCode: 137,
      signal: null,
      scope: "SWARM",
    });
  });

  it("supports health status action variants and kill signals", () => {
    expect(
      normalizeDockerEvent(
        event({ Action: "health_status: unhealthy" }),
      ),
    ).toMatchObject({ action: "HEALTH_STATUS", health: "UNHEALTHY" });

    expect(
      normalizeDockerEvent(
        event({
          Action: "kill",
          Actor: {
            ID: CONTAINER_ID,
            Attributes: { name: "homeassistant", image: "ha:stable", signal: "15" },
          },
        }),
      ),
    ).toMatchObject({ action: "KILL", signal: "15" });
  });

  it("ignores unsupported object/action events but fails malformed accepted identities", () => {
    expect(normalizeDockerEvent(event({ Type: "image" }))).toBeNull();
    expect(normalizeDockerEvent(event({ Action: "attach" }))).toBeNull();
    expect(
      () =>
        normalizeDockerEvent(
          event({ Actor: { ID: "short", Attributes: { name: "bad" } } }),
        ),
    ).toThrow(DockerSourceUnavailableError);
  });
});

describe("recent Docker event snapshot", () => {
  it("uses a fixed 60-minute window, de-duplicates exact events and sorts newest first", async () => {
    let requestedPath = "";
    const transport: DockerEventsTransport = {
      async read(path) {
        requestedPath = path;
        const older = event({ time: 1_765_799_990 });
        const newer = event({
          Action: "stop",
          Actor: {
            ID: SECOND_CONTAINER_ID,
            Attributes: { name: "grafana", image: "grafana/grafana" },
          },
          time: 1_765_799_999,
        });
        return [older, newer, older];
      },
    };

    const now = new Date("2025-12-15T05:20:00.900Z");
    const snapshot = await readRecentDockerEvents(transport, undefined, () => now);

    expect(isAllowedDockerEventsPath(requestedPath)).toBe(true);
    const url = new URL(requestedPath, "http://docker.local");
    expect(Number(url.searchParams.get("until"))).toBe(Math.floor(now.getTime() / 1_000));
    expect(
      Number(url.searchParams.get("until")) - Number(url.searchParams.get("since")),
    ).toBe(DOCKER_EVENTS_LOOKBACK_SECONDS);
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.events.map((entry) => entry.containerId)).toEqual([
      SECOND_CONTAINER_ID,
      CONTAINER_ID,
    ]);
    expect(snapshot.observedAt).toBe(now.toISOString());
  });

  it("returns an empty valid snapshot when the bounded window has no events", async () => {
    const transport: DockerEventsTransport = { async read() { return []; } };
    const snapshot = await readRecentDockerEvents(
      transport,
      undefined,
      () => new Date("2025-12-15T05:20:00.000Z"),
    );
    expect(snapshot.events).toEqual([]);
  });
});
