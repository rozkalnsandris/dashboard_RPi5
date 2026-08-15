import { describe, expect, it } from "vitest";

import {
  InvalidOperationRegistrationError,
  OperationRegistry,
  OperationTimeoutError,
  UnknownOperationError,
  normalizeAgentError,
} from "./operation-registry.js";

describe("OperationRegistry", () => {
  it("runs only server-registered operation IDs", async () => {
    const registry = new OperationRegistry();
    registry.register("protocol.echo", async () => ({ ok: true }));

    await expect(registry.run("protocol.echo")).resolves.toEqual({ ok: true });
    await expect(registry.run("shell.arbitrary")).rejects.toBeInstanceOf(
      UnknownOperationError,
    );
    expect(registry.list()).toEqual(["protocol.echo"]);
  });

  it("rejects malformed and duplicate registrations", () => {
    const registry = new OperationRegistry();
    registry.register("protocol.echo", async () => true);

    expect(() => registry.register("protocol.echo", async () => true)).toThrow(
      InvalidOperationRegistrationError,
    );
    expect(() => registry.register("../../bin/sh", async () => true)).toThrow(
      InvalidOperationRegistrationError,
    );
  });

  it("aborts operations that exceed the bounded timeout", async () => {
    const registry = new OperationRegistry();
    let aborted = false;

    registry.register(
      "protocol.wait",
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    );

    await expect(
      registry.run("protocol.wait", { timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(OperationTimeoutError);
    expect(aborted).toBe(true);
  });

  it("normalizes errors without returning raw messages", () => {
    expect(normalizeAgentError(new UnknownOperationError())).toEqual({
      error: "INVALID_OPERATION",
    });
    expect(normalizeAgentError(new OperationTimeoutError())).toEqual({
      error: "OPERATION_TIMEOUT",
    });
    expect(normalizeAgentError(new Error("/secret/path token=abc"))).toEqual({
      error: "INTERNAL_ERROR",
    });
  });
});
