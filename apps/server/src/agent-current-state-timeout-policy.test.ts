import { describe, expect, it } from "vitest";

import {
  AGENT_CURRENT_STATE_TIMEOUT_MS,
  AGENT_DOCKER_CURRENT_STATE_TIMEOUT_MS,
  createAgentDockerContainersReader,
  createAgentHostSummaryReader,
} from "./agent-current-state-client.js";

describe("server current-state timeout policy", () => {
  it("keeps host telemetry fast while giving Docker a separate bounded outer deadline", () => {
    expect(AGENT_CURRENT_STATE_TIMEOUT_MS).toBe(1_500);
    expect(AGENT_DOCKER_CURRENT_STATE_TIMEOUT_MS).toBe(10_000);
    expect(AGENT_DOCKER_CURRENT_STATE_TIMEOUT_MS).toBeGreaterThan(AGENT_CURRENT_STATE_TIMEOUT_MS);

    expect(() =>
      createAgentHostSummaryReader({ socketPath: "/tmp/agent.sock", timeoutMs: 5_001 }),
    ).toThrow(RangeError);
    expect(() =>
      createAgentDockerContainersReader({ socketPath: "/tmp/agent.sock", timeoutMs: 15_001 }),
    ).toThrow(RangeError);
  });
});
