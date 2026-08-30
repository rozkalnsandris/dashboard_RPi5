import { describe, expect, it } from "vitest";

import {
  DASHBOARD_DOCKER_API_MAX_VERSION,
  DASHBOARD_DOCKER_API_MIN_VERSION,
  DASHBOARD_DOCKER_API_PREFERRED_VERSION,
  DockerApiVersionCompatibilityError,
  dockerApiPrefix,
  selectDockerApiVersion,
} from "./docker-api-version.js";

describe("Docker API version policy", () => {
  it("selects the dashboard preferred API when the daemon range contains it", () => {
    expect(
      selectDockerApiVersion({ ApiVersion: "1.55", MinAPIVersion: "1.40" }),
    ).toBe(DASHBOARD_DOCKER_API_PREFERRED_VERSION);
  });

  it("selects a supported higher API when the daemon minimum is above the old fixed API", () => {
    expect(selectDockerApiVersion({ ApiVersion: "1.55", MinAPIVersion: "1.44" })).toBe("1.55");
  });

  it("selects the highest supported overlap below the preferred API", () => {
    expect(selectDockerApiVersion({ ApiVersion: "1.48", MinAPIVersion: "1.42" })).toBe("1.48");
  });

  it("fails closed when there is no supported overlap", () => {
    expect(() =>
      selectDockerApiVersion({ ApiVersion: "1.39", MinAPIVersion: "1.24" }),
    ).toThrow(DockerApiVersionCompatibilityError);
    expect(() =>
      selectDockerApiVersion({ ApiVersion: "1.60", MinAPIVersion: "1.56" }),
    ).toThrow(DockerApiVersionCompatibilityError);
  });

  it("fails closed on malformed or inverted daemon version evidence", () => {
    for (const evidence of [
      null,
      {},
      { ApiVersion: "1.55" },
      { ApiVersion: "1.55/containers/json", MinAPIVersion: "1.40" },
      { ApiVersion: "1.55?x=y", MinAPIVersion: "1.40" },
      { ApiVersion: "1.40", MinAPIVersion: "1.55" },
      { ApiVersion: "01.55", MinAPIVersion: "1.40" },
    ]) {
      expect(() => selectDockerApiVersion(evidence)).toThrow(
        DockerApiVersionCompatibilityError,
      );
    }
  });

  it("builds prefixes only for versions inside the dashboard-supported interval", () => {
    expect(dockerApiPrefix(DASHBOARD_DOCKER_API_MIN_VERSION)).toBe("/v1.40");
    expect(dockerApiPrefix(DASHBOARD_DOCKER_API_MAX_VERSION)).toBe("/v1.55");
    for (const value of ["1.39", "1.56", "1.55/containers/json", "1.55?x=y", "v1.55"]) {
      expect(() => dockerApiPrefix(value)).toThrow(DockerApiVersionCompatibilityError);
    }
  });
});
