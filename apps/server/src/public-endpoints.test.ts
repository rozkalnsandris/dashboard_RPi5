import type { EndpointEvidenceSnapshot } from "@dashboard-rpi5/contracts/endpoints";
import { describe, expect, it } from "vitest";

import { createPublicEndpointsReader, PublicEndpointsSourceUnavailableError } from "./public-endpoints.js";

const evidence: EndpointEvidenceSnapshot = {
  observedAt: "2026-08-15T20:10:00.000Z",
  schema: "dashboard-rpi5.endpoint-evidence.v1",
  events: [
    {
      eventId: "grafana-down",
      endpointId: "grafana",
      label: "Grafana",
      occurredAt: "2026-08-15T20:05:00.000Z",
      fromState: "UP",
      toState: "DOWN",
      statusCode: 502,
      latencyMs: 1_240,
    },
    {
      eventId: "tech-up-latest",
      endpointId: "tech",
      label: "Hermes Tech",
      occurredAt: "2026-08-15T20:04:00.000Z",
      fromState: "DOWN",
      toState: "UP",
      statusCode: 200,
      latencyMs: 84,
    },
    {
      eventId: "tech-down-old",
      endpointId: "tech",
      label: "Hermes Tech",
      occurredAt: "2026-08-15T19:00:00.000Z",
      fromState: "UP",
      toState: "DOWN",
      statusCode: 503,
      latencyMs: 500,
    },
  ],
};

describe("Phase 6B public endpoint normalization", () => {
  it("uses only the newest transition per endpoint and surfaces outage attention first", async () => {
    const read = createPublicEndpointsReader({
      endpointEvidenceReader: async () => evidence,
      now: () => new Date("2026-08-15T20:10:00.000Z"),
    });

    await expect(read()).resolves.toEqual({
      observedAt: "2026-08-15T20:10:00.000Z",
      health: "ATTENTION",
      endpoints: [
        {
          endpointId: "grafana",
          label: "Grafana",
          state: "DOWN",
          lastChangedAt: "2026-08-15T20:05:00.000Z",
          statusCode: 502,
          latencyMs: 1_240,
        },
        {
          endpointId: "tech",
          label: "Hermes Tech",
          state: "UP",
          lastChangedAt: "2026-08-15T20:04:00.000Z",
          statusCode: 200,
          latencyMs: 84,
        },
      ],
    });
  });

  it("keeps empty or unknown evidence unknown", async () => {
    const empty = createPublicEndpointsReader({
      endpointEvidenceReader: async () => ({ ...evidence, events: [] }),
      now: () => new Date("2026-08-15T20:10:00.000Z"),
    });
    await expect(empty()).resolves.toMatchObject({ health: "UNKNOWN", endpoints: [] });

    const unknownEvent = { ...evidence.events[1]!, eventId: "tech-unknown", fromState: "UP" as const, toState: "UNKNOWN" as const };
    const unknown = createPublicEndpointsReader({
      endpointEvidenceReader: async () => ({ ...evidence, events: [unknownEvent] }),
      now: () => new Date("2026-08-15T20:10:00.000Z"),
    });
    await expect(unknown()).resolves.toMatchObject({ health: "UNKNOWN" });
  });

  it("fails closed for future transitions", async () => {
    const futureEvent = { ...evidence.events[0]!, occurredAt: "2026-08-15T20:10:01.000Z" };
    const read = createPublicEndpointsReader({
      endpointEvidenceReader: async () => ({ ...evidence, events: [futureEvent] }),
      now: () => new Date("2026-08-15T20:10:00.000Z"),
    });
    await expect(read()).rejects.toBeInstanceOf(PublicEndpointsSourceUnavailableError);
  });

  it("fails closed rather than hiding an endpoint when more than eight distinct IDs appear", async () => {
    const read = createPublicEndpointsReader({
      endpointEvidenceReader: async () => ({
        ...evidence,
        events: Array.from({ length: 9 }, (_, index) => ({
          eventId: `event-${index}`,
          endpointId: `endpoint-${index}`,
          label: `Endpoint ${index}`,
          occurredAt: `2026-08-15T20:0${index}:00.000Z`,
          fromState: "DOWN" as const,
          toState: "UP" as const,
          statusCode: 200,
          latencyMs: index,
        })),
      }),
      now: () => new Date("2026-08-15T20:10:00.000Z"),
    });
    await expect(read()).rejects.toBeInstanceOf(PublicEndpointsSourceUnavailableError);
  });
});
