import { describe, expect, it, vi } from "vitest";

import {
  buildPrivilegedJournalctlArgs,
  readPrivilegedLogSnapshot,
  type PrivilegedLogReadDependencies,
} from "./log-broker-reader.js";

function dependencies(overrides: Partial<PrivilegedLogReadDependencies> = {}): PrivilegedLogReadDependencies {
  return {
    now: () => new Date("2026-08-28T08:00:00.000Z"),
    execFile: vi.fn(async () => ({
      stdout: JSON.stringify({ __REALTIME_TIMESTAMP: "1787904000000000", PRIORITY: "6", MESSAGE: "service ready" }) + "\n",
    })),
    readFileTail: vi.fn(async () => ({ text: "2026-08-28T07:59:00Z backup ok\n", truncated: false })),
    ...overrides,
  };
}

describe("privileged log broker reader", () => {
  it("builds journalctl argv from the server-owned unit mapping", () => {
    const args = buildPrivilegedJournalctlArgs("systemd:cloudflared", "1h");
    expect(args).toContain("--unit=cloudflared.service");
    expect(args).toContain("--since=-1h");
  });

  it("reads a fixed systemd source without shell or caller-supplied unit data", async () => {
    const deps = dependencies();
    const snapshot = await readPrivilegedLogSnapshot("systemd:rpi5-monitor", "1h", undefined, deps);
    expect(snapshot.source.sourceId).toBe("systemd:rpi5-monitor");
    expect(snapshot.rangeApplied).toBe(true);
    expect(snapshot.entries[0]?.message).toBe("service ready");
    expect(deps.execFile).toHaveBeenCalledWith(
      "/usr/bin/journalctl",
      expect.arrayContaining(["--unit=rpi5-monitor.service", "--since=-1h", "--lines=400"]),
      expect.objectContaining({ shell: false, timeout: 1500, maxBuffer: 512 * 1024 }),
    );
  });

  it("reads only the fixed backup path and preserves tail-only semantics", async () => {
    const deps = dependencies();
    const snapshot = await readPrivilegedLogSnapshot("file:rpi5-backup", "24h", undefined, deps);
    expect(deps.readFileTail).toHaveBeenCalledWith("/var/log/rpi5-backup.log", 256 * 1024, undefined);
    expect(snapshot.rangeApplied).toBe(false);
    expect(snapshot.entries[0]?.message).toBe("backup ok");
  });
});
