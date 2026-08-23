import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DeploySourceUnavailableError, readDeployEvidence } from "./deploy-events.js";
import { MaintenanceSourceUnavailableError, readMaintenanceEvidence } from "./maintenance-events.js";
import {
  DEFAULT_THROTTLE_EVIDENCE_MAX_AGE_MS,
  ThrottleSourceUnavailableError,
  parseThrottleEvidence,
  readThrottleEvidence,
} from "./throttle-evidence.js";

const directories: string[] = [];
const currentUid = process.getuid?.() ?? 0;

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-producer-evidence-"));
  directories.push(directory);
  return directory;
}

async function writeJson(directory: string, name: string, value: unknown): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o644 });
  return path;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("#196 producer evidence consumers", () => {
  it("reads maintenance snapshot from the fixed-file contract and refreshes observation time", async () => {
    const directory = await makeDirectory();
    const path = await writeJson(directory, "maintenance.json", {
      observedAt: "2026-08-22T20:00:00.000Z",
      events: [
        {
          invocationId: "0123456789abcdef0123456789abcdef",
          occurredAt: "2026-08-22T19:59:00.000Z",
          result: "SUCCESS",
          unitResult: null,
        },
      ],
    });

    await expect(
      readMaintenanceEvidence({ path, requiredUid: currentUid, now: () => new Date("2026-08-22T20:05:00.000Z") }),
    ).resolves.toEqual({
      observedAt: "2026-08-22T20:05:00.000Z",
      events: [
        {
          invocationId: "0123456789abcdef0123456789abcdef",
          occurredAt: "2026-08-22T19:59:00.000Z",
          result: "SUCCESS",
          unitResult: null,
        },
      ],
    });
  });

  it("reads deploy verification snapshot without journal access", async () => {
    const directory = await makeDirectory();
    const path = await writeJson(directory, "deployments.json", {
      observedAt: "2026-08-22T20:00:00.000Z",
      events: [
        {
          transactionId: "20260822T201234123456Z-abcdef123456",
          commit: "abcdef123456",
          occurredAt: "2026-08-22T20:12:34.123Z",
        },
      ],
    });

    const result = await readDeployEvidence({
      path,
      requiredUid: currentUid,
      now: () => new Date("2026-08-22T20:15:00.000Z"),
    });
    expect(result.observedAt).toBe("2026-08-22T20:15:00.000Z");
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.commit).toBe("abcdef123456");
  });

  it("fails closed for malformed maintenance and deploy evidence", async () => {
    const directory = await makeDirectory();
    const maintenance = await writeJson(directory, "maintenance.json", { observedAt: "bad", events: [] });
    const deploy = await writeJson(directory, "deployments.json", { observedAt: "bad", events: [] });

    await expect(readMaintenanceEvidence({ path: maintenance, requiredUid: currentUid })).rejects.toBeInstanceOf(MaintenanceSourceUnavailableError);
    await expect(readDeployEvidence({ path: deploy, requiredUid: currentUid })).rejects.toBeInstanceOf(DeploySourceUnavailableError);
  });

  it("decodes fresh throttle evidence and rejects stale or future evidence", async () => {
    const now = new Date("2026-08-22T20:10:00.000Z");
    expect(
      parseThrottleEvidence(
        {
          schema: "dashboard-rpi5.throttle-evidence.v1",
          observedAt: "2026-08-22T20:09:00.000Z",
          rawHex: "0x50005",
        },
        now,
      ),
    ).toEqual({
      rawHex: "0x50005",
      rawValue: 0x50005,
      current: {
        underVoltage: true,
        armFrequencyCapped: false,
        throttled: true,
        softTemperatureLimit: false,
      },
      occurred: {
        underVoltage: true,
        armFrequencyCapped: false,
        throttled: true,
        softTemperatureLimit: false,
      },
    });

    expect(() =>
      parseThrottleEvidence(
        {
          schema: "dashboard-rpi5.throttle-evidence.v1",
          observedAt: new Date(now.getTime() - DEFAULT_THROTTLE_EVIDENCE_MAX_AGE_MS - 1).toISOString(),
          rawHex: "0x0",
        },
        now,
      ),
    ).toThrow(ThrottleSourceUnavailableError);

    expect(() =>
      parseThrottleEvidence(
        {
          schema: "dashboard-rpi5.throttle-evidence.v1",
          observedAt: "2026-08-22T20:10:01.000Z",
          rawHex: "0x0",
        },
        now,
      ),
    ).toThrow(ThrottleSourceUnavailableError);
  });

  it("reads fresh throttle evidence through the strict root-owned file boundary", async () => {
    const directory = await makeDirectory();
    const path = await writeJson(directory, "throttle.json", {
      schema: "dashboard-rpi5.throttle-evidence.v1",
      observedAt: "2026-08-22T20:09:00.000Z",
      rawHex: "0x0",
    });

    await expect(
      readThrottleEvidence({
        path,
        requiredUid: currentUid,
        now: () => new Date("2026-08-22T20:10:00.000Z"),
      }),
    ).resolves.toMatchObject({ rawHex: "0x0", rawValue: 0 });
  });
});
