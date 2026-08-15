import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  EndpointSourceUnavailableError,
  readEndpointEvidence,
} from "./endpoint-evidence.js";

const directories: string[] = [];
const currentUid = process.getuid?.() ?? 0;

async function makeDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "dashboard-endpoint-evidence-"));
  directories.push(directory);
  return directory;
}

async function writeEvidence(directory: string, value: unknown, mode = 0o600) {
  const path = join(directory, "endpoints.json");
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
  await chmod(path, mode);
  return path;
}

const validEvidence = {
  schema: "dashboard-rpi5.endpoint-evidence.v1",
  events: [
    {
      eventId: "tech-down-20260815T180000Z",
      endpointId: "tech",
      label: "Hermes Tech",
      occurredAt: "2026-08-15T18:00:00Z",
      fromState: "UP",
      toState: "DOWN",
      statusCode: 503,
      latencyMs: 1500,
    },
    {
      eventId: "tech-up-20260815T181000Z",
      endpointId: "tech",
      label: "Hermes Tech",
      occurredAt: "2026-08-15T18:10:00Z",
      fromState: "DOWN",
      toState: "UP",
      statusCode: 200,
      latencyMs: 120,
    },
  ],
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Phase 5C-E structured endpoint evidence reader", () => {
  it("reads only a safe regular file and normalizes transitions newest-first", async () => {
    const directory = await makeDirectory();
    const path = await writeEvidence(directory, validEvidence);

    await expect(
      readEndpointEvidence({
        path,
        requiredUid: currentUid,
        now: () => new Date("2026-08-15T19:00:00.000Z"),
      }),
    ).resolves.toEqual({
      observedAt: "2026-08-15T19:00:00.000Z",
      schema: "dashboard-rpi5.endpoint-evidence.v1",
      events: [validEvidence.events[1], validEvidence.events[0]],
    });
  });

  it("fails closed for missing, non-regular, wrong-owner, symlink and writable evidence", async () => {
    const directory = await makeDirectory();
    await expect(
      readEndpointEvidence({ path: join(directory, "missing.json"), requiredUid: currentUid }),
    ).rejects.toBeInstanceOf(EndpointSourceUnavailableError);

    await expect(
      readEndpointEvidence({ path: directory, requiredUid: currentUid }),
    ).rejects.toBeInstanceOf(EndpointSourceUnavailableError);

    const target = await writeEvidence(directory, validEvidence);
    await expect(
      readEndpointEvidence({ path: target, requiredUid: currentUid + 1 }),
    ).rejects.toBeInstanceOf(EndpointSourceUnavailableError);

    const link = join(directory, "link.json");
    await symlink(target, link);
    await expect(
      readEndpointEvidence({ path: link, requiredUid: currentUid }),
    ).rejects.toBeInstanceOf(EndpointSourceUnavailableError);

    await chmod(target, 0o660);
    await expect(
      readEndpointEvidence({ path: target, requiredUid: currentUid }),
    ).rejects.toBeInstanceOf(EndpointSourceUnavailableError);
  });

  it("rejects oversized and unknown-key evidence without direct-probe fallback", async () => {
    const directory = await makeDirectory();
    const oversized = join(directory, "oversized.json");
    await writeFile(
      oversized,
      `{"schema":"dashboard-rpi5.endpoint-evidence.v1","events":[],"pad":"${"x".repeat(2_000)}"}`,
      { mode: 0o600 },
    );
    await expect(
      readEndpointEvidence({ path: oversized, requiredUid: currentUid, maxBytes: 1_024 }),
    ).rejects.toBeInstanceOf(EndpointSourceUnavailableError);

    const malformed = await writeEvidence(directory, {
      ...validEvidence,
      sourceUrl: "https://secret.example.invalid",
    });
    await expect(
      readEndpointEvidence({ path: malformed, requiredUid: currentUid }),
    ).rejects.toBeInstanceOf(EndpointSourceUnavailableError);
  });

  it("rejects ambiguous timestamps, invalid calendar dates, no-op transitions and unsafe labels", async () => {
    const cases = [
      {
        ...validEvidence,
        events: [{ ...validEvidence.events[0], occurredAt: "2026-08-15T18:00:00" }],
      },
      {
        ...validEvidence,
        events: [{ ...validEvidence.events[0], occurredAt: "2026-02-30T18:00:00Z" }],
      },
      {
        ...validEvidence,
        events: [{ ...validEvidence.events[0], fromState: "DOWN", toState: "DOWN" }],
      },
      {
        ...validEvidence,
        events: [{ ...validEvidence.events[0], label: " Hermes Tech" }],
      },
      {
        ...validEvidence,
        events: [{ ...validEvidence.events[0], label: "Hermes\nTech" }],
      },
    ];

    for (const value of cases) {
      const directory = await makeDirectory();
      const path = await writeEvidence(directory, value);
      await expect(
        readEndpointEvidence({ path, requiredUid: currentUid }),
      ).rejects.toBeInstanceOf(EndpointSourceUnavailableError);
    }
  });

  it("rejects duplicate IDs and histories above the fixed maximum", async () => {
    const duplicateDirectory = await makeDirectory();
    const duplicatePath = await writeEvidence(duplicateDirectory, {
      ...validEvidence,
      events: [
        validEvidence.events[0],
        { ...validEvidence.events[1], eventId: validEvidence.events[0]!.eventId },
      ],
    });
    await expect(
      readEndpointEvidence({ path: duplicatePath, requiredUid: currentUid }),
    ).rejects.toBeInstanceOf(EndpointSourceUnavailableError);

    const oversizedDirectory = await makeDirectory();
    const events = Array.from({ length: 65 }, (_, index) => ({
      ...validEvidence.events[0],
      eventId: `event-${index}`,
      occurredAt: `2026-08-15T18:${String(index % 60).padStart(2, "0")}:00Z`,
    }));
    const oversizedPath = await writeEvidence(oversizedDirectory, { ...validEvidence, events });
    await expect(
      readEndpointEvidence({ path: oversizedPath, requiredUid: currentUid }),
    ).rejects.toBeInstanceOf(EndpointSourceUnavailableError);
  });
});
