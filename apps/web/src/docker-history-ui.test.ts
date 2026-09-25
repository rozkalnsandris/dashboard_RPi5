import { describe, expect, it } from "vitest";

import {
  buildDockerHistorySparklinePoints,
  dockerIdentityLabel,
  formatDockerHistoryValue,
  parseDockerTopConsumersSnapshot,
} from "./docker-history-ui";

const point = (timestamp: string, value: number) => ({ timestamp, value });

function fixture() {
  return {
    observedAt: "2026-09-25T12:00:00.000Z",
    range: "1h",
    windowStart: "2026-09-25T11:00:00.000Z",
    windowEnd: "2026-09-25T12:00:00.000Z",
    rankings: [
      {
        metric: "CPU_PERCENT",
        state: "AVAILABLE",
        consumers: [
          {
            identity: { composeProject: "home", composeService: "api", composeContainerNumber: "1" },
            latest: 20,
            average: 15,
            maximum: 20,
            points: [
              point("2026-09-25T11:00:00.000Z", 10),
              point("2026-09-25T12:00:00.000Z", 20),
            ],
          },
        ],
      },
      { metric: "MEMORY_WORKING_SET_BYTES", state: "UNAVAILABLE", consumers: [] },
    ],
  };
}

describe("Docker history UI contract", () => {
  it("parses a bounded snapshot and exposes accessible labels/formatting", () => {
    const snapshot = parseDockerTopConsumersSnapshot(fixture());
    const cpu = snapshot.rankings[0];
    expect(cpu?.state).toBe("AVAILABLE");
    if (cpu?.state !== "AVAILABLE") throw new Error("fixture must be available");
    const consumer = cpu.consumers[0];
    if (consumer === undefined) throw new Error("fixture must include a consumer");
    expect(dockerIdentityLabel(consumer.identity)).toBe("home/api #1");
    expect(formatDockerHistoryValue("CPU_PERCENT", consumer.latest)).toBe("20.0%");
    expect(buildDockerHistorySparklinePoints(consumer)).not.toBe("");
  });

  it("rejects duplicate metrics, malformed identities, and inconsistent summaries", () => {
    const duplicateMetric = fixture();
    duplicateMetric.rankings[1] = { ...duplicateMetric.rankings[0] };
    expect(() => parseDockerTopConsumersSnapshot(duplicateMetric)).toThrow();

    const malformedIdentity = fixture();
    const malformedRanking = malformedIdentity.rankings[0];
    const malformedConsumer = malformedRanking?.consumers[0];
    if (malformedConsumer === undefined) throw new Error("fixture must include a consumer");
    malformedConsumer.identity.composeService = "Bad Service";
    expect(() => parseDockerTopConsumersSnapshot(malformedIdentity)).toThrow();

    const inconsistent = fixture();
    const inconsistentRanking = inconsistent.rankings[0];
    const inconsistentConsumer = inconsistentRanking?.consumers[0];
    if (inconsistentConsumer === undefined) throw new Error("fixture must include a consumer");
    inconsistentConsumer.average = 999;
    expect(() => parseDockerTopConsumersSnapshot(inconsistent)).toThrow();
  });
});
