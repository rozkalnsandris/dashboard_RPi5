import { describe, expect, it } from "vitest";

import { HostEvidenceParseError, calculateFilesystemUsage } from "./host-read.js";

describe("filesystem capacity semantics", () => {
  it("reconciles used and available capacity when there are no reserved blocks", () => {
    expect(
      calculateFilesystemUsage({
        bsize: 4_096n,
        blocks: 1_000n,
        bfree: 250n,
        bavail: 250n,
      }),
    ).toEqual({
      path: "/",
      totalBytes: 4_096_000,
      availableBytes: 1_024_000,
      usedBytes: 3_072_000,
      usedPercent: 75,
    });
  });

  it("does not count reserved free capacity as physically used", () => {
    const summary = calculateFilesystemUsage({
      bsize: 4_096n,
      blocks: 1_000n,
      bfree: 300n,
      bavail: 250n,
    });

    expect(summary).toEqual({
      path: "/",
      totalBytes: 4_096_000,
      availableBytes: 1_024_000,
      usedBytes: 2_867_200,
      usedPercent: 70,
    });

    const freeBytes = 300 * 4_096;
    const reservedBytes = freeBytes - summary.availableBytes;
    expect(summary.availableBytes).toBeLessThanOrEqual(freeBytes);
    expect(freeBytes).toBeLessThanOrEqual(summary.totalBytes);
    expect(reservedBytes).toBe(204_800);
    expect(summary.usedBytes + freeBytes).toBe(summary.totalBytes);
  });

  it("fails closed on impossible free/available relationships", () => {
    expect(() =>
      calculateFilesystemUsage({
        bsize: 4_096n,
        blocks: 1_000n,
        bfree: 200n,
        bavail: 250n,
      }),
    ).toThrow(HostEvidenceParseError);

    expect(() =>
      calculateFilesystemUsage({
        bsize: 4_096n,
        blocks: 1_000n,
        bfree: -1n,
        bavail: 0n,
      }),
    ).toThrow(HostEvidenceParseError);
  });

  it("fails closed when byte arithmetic exceeds JavaScript safe integers", () => {
    expect(() =>
      calculateFilesystemUsage({
        bsize: BigInt(Number.MAX_SAFE_INTEGER),
        blocks: 2n,
        bfree: 1n,
        bavail: 1n,
      }),
    ).toThrow(HostEvidenceParseError);
  });

  it("keeps legacy injected no-reservation fixtures equivalent to bfree=bavail", () => {
    expect(
      calculateFilesystemUsage({ bsize: 4_096n, blocks: 1_000n, bavail: 250n }),
    ).toEqual(
      calculateFilesystemUsage({
        bsize: 4_096n,
        blocks: 1_000n,
        bfree: 250n,
        bavail: 250n,
      }),
    );
  });
});
