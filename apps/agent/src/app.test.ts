import { AgentHealthSchema } from "@dashboard-rpi5/contracts";
import { Value } from "@sinclair/typebox/value";
import { afterEach, describe, expect, it } from "vitest";

import { buildAgentApp } from "./app.js";

const apps: ReturnType<typeof buildAgentApp>["app"][] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("agent health protocol", () => {
  it("returns the versioned source-only contract", async () => {
    const { app } = buildAgentApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/health" });
    expect(response.statusCode).toBe(200);

    const payload = response.json();
    expect(Value.Check(AgentHealthSchema, payload)).toBe(true);
    expect(payload).toMatchObject({
      status: "ok",
      service: "dashboard-rpi5-agent",
      mode: "SOURCE_ONLY",
      protocolVersion: 1,
      agentVersion: "0.2.0",
      capabilities: ["protocol.health"],
    });
  });

  it("normalizes unknown routes without leaking internal details", async () => {
    const { app } = buildAgentApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/not-real" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "NOT_FOUND" });
  });
});
