import { describe, expect, it } from "vitest";

import { defaultOperationTimeoutMs } from "./operation-registry.js";
import {
  DEFAULT_OPERATION_TIMEOUT_MS,
  DOCKER_CONTAINERS_OPERATION_TIMEOUT_MS,
  MAX_OPERATION_TIMEOUT_MS,
} from "./protocol.js";

describe("agent operation timeout policy", () => {
  it("widens only docker.containers while preserving the default for other operations", () => {
    expect(DEFAULT_OPERATION_TIMEOUT_MS).toBe(5_000);
    expect(DOCKER_CONTAINERS_OPERATION_TIMEOUT_MS).toBe(8_000);
    expect(DOCKER_CONTAINERS_OPERATION_TIMEOUT_MS).toBeLessThan(MAX_OPERATION_TIMEOUT_MS);

    expect(defaultOperationTimeoutMs("docker.containers")).toBe(
      DOCKER_CONTAINERS_OPERATION_TIMEOUT_MS,
    );
    expect(defaultOperationTimeoutMs("host.summary")).toBe(DEFAULT_OPERATION_TIMEOUT_MS);
    expect(defaultOperationTimeoutMs("services.status")).toBe(DEFAULT_OPERATION_TIMEOUT_MS);
    expect(defaultOperationTimeoutMs("backups.recent")).toBe(DEFAULT_OPERATION_TIMEOUT_MS);
  });
});
