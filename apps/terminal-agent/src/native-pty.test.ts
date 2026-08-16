import { describe, expect, it, vi } from "vitest";

import {
  createTerminalNativePtyFactory,
  TERMINAL_NATIVE_LANG,
  TERMINAL_NATIVE_PATH,
  TERMINAL_NATIVE_SHELL,
  TERMINAL_NATIVE_SHELL_ARGS,
  TERMINAL_NATIVE_TERM,
  TerminalNativePtyInputError,
  TerminalNativePtyUnavailableError,
  type TerminalNativeRuntime,
} from "./native-pty.js";

function fakePty(pid = 123) {
  return {
    pid,
    cols: 80,
    rows: 24,
    process: "bash",
    handleFlowControl: false,
    write: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
    kill: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

function validRuntime(overrides: Partial<TerminalNativeRuntime> = {}) {
  const pty = fakePty();
  const spawn = vi.fn(() => pty);
  const runtime: TerminalNativeRuntime = {
    platform: "linux",
    arch: "arm64",
    getEffectiveUid: () => 1000,
    getEffectiveGid: () => 1000,
    getGroups: () => [1000],
    getUserInfo: () => ({
      username: "dashboard-terminal",
      uid: 1000,
      gid: 1000,
      homedir: "/var/lib/dashboard-terminal",
    }),
    loadNodePty: () => ({ spawn }),
    ...overrides,
  };
  return { runtime, pty, spawn };
}

describe("isolated native PTY adapter", () => {
  it("rejects unsupported platform, architecture, root and missing POSIX identity before native load", () => {
    for (const overrides of [
      { platform: "darwin" as NodeJS.Platform },
      { arch: "riscv64" },
      { getEffectiveUid: () => 0 },
      { getEffectiveGid: () => 0 },
      { getEffectiveUid: () => undefined },
      { getGroups: () => undefined },
    ]) {
      const loadNodePty = vi.fn(() => ({ spawn: vi.fn() }));
      const { runtime } = validRuntime({ ...overrides, loadNodePty });
      expect(() => createTerminalNativePtyFactory(runtime)).toThrow(
        TerminalNativePtyUnavailableError,
      );
      expect(loadNodePty).not.toHaveBeenCalled();
    }
  });

  it("rejects every supplementary group beyond the primary group before native load", () => {
    for (const groups of [[1000, 999], [999], [], [1000, -1], [1000, 1000.5]]) {
      const loadNodePty = vi.fn(() => ({ spawn: vi.fn() }));
      const { runtime } = validRuntime({ getGroups: () => groups, loadNodePty });
      expect(() => createTerminalNativePtyFactory(runtime)).toThrow(
        TerminalNativePtyUnavailableError,
      );
      expect(loadNodePty).not.toHaveBeenCalled();
    }
  });

  it("rejects mismatched or unsafe effective user metadata before native load", () => {
    for (const getUserInfo of [
      () => ({ username: "dashboard-terminal", uid: 1001, gid: 1000, homedir: "/var/lib/dashboard-terminal" }),
      () => ({ username: "dashboard-terminal", uid: 1000, gid: 1001, homedir: "/var/lib/dashboard-terminal" }),
      () => ({ username: "bad user", uid: 1000, gid: 1000, homedir: "/var/lib/dashboard-terminal" }),
      () => ({ username: "dashboard-terminal", uid: 1000, gid: 1000, homedir: "/" }),
      () => ({ username: "dashboard-terminal", uid: 1000, gid: 1000, homedir: "relative/home" }),
    ]) {
      const loadNodePty = vi.fn(() => ({ spawn: vi.fn() }));
      const { runtime } = validRuntime({ getUserInfo, loadNodePty });
      expect(() => createTerminalNativePtyFactory(runtime)).toThrow(
        TerminalNativePtyUnavailableError,
      );
      expect(loadNodePty).not.toHaveBeenCalled();
    }
  });

  it("spawns only fixed bash with a fresh allowlisted environment", () => {
    const { runtime, spawn } = validRuntime();
    createTerminalNativePtyFactory(runtime).create({ cols: 100, rows: 30 });

    expect(spawn).toHaveBeenCalledWith(TERMINAL_NATIVE_SHELL, [...TERMINAL_NATIVE_SHELL_ARGS], {
      name: TERMINAL_NATIVE_TERM,
      cols: 100,
      rows: 30,
      cwd: "/var/lib/dashboard-terminal",
      env: {
        HOME: "/var/lib/dashboard-terminal",
        USER: "dashboard-terminal",
        LOGNAME: "dashboard-terminal",
        SHELL: TERMINAL_NATIVE_SHELL,
        PATH: TERMINAL_NATIVE_PATH,
        TERM: TERMINAL_NATIVE_TERM,
        COLORTERM: "truecolor",
        LANG: TERMINAL_NATIVE_LANG,
      },
      encoding: "utf8",
      handleFlowControl: false,
    });

    const options = spawn.mock.calls[0]?.[2] as { env: Record<string, string> };
    expect(Object.keys(options.env).sort()).toEqual(
      ["COLORTERM", "HOME", "LANG", "LOGNAME", "PATH", "SHELL", "TERM", "USER"].sort(),
    );
    expect(options).not.toHaveProperty("uid");
    expect(options).not.toHaveProperty("gid");
  });

  it("bounds initial and later resize dimensions independently of the browser layer", () => {
    const { runtime, pty } = validRuntime();
    const factory = createTerminalNativePtyFactory(runtime);

    expect(() => factory.create({ cols: 1, rows: 24 })).toThrow(TerminalNativePtyInputError);
    expect(() => factory.create({ cols: 80, rows: 201 })).toThrow(TerminalNativePtyInputError);
    const process = factory.create({ cols: 80, rows: 24 });
    expect(() => process.resize(301, 24)).toThrow(TerminalNativePtyInputError);
    process.resize(120, 40);
    expect(pty.resize).toHaveBeenCalledWith(120, 40);
  });

  it("delegates write/events and uses fixed SIGHUP for direct shell hangup", () => {
    const { runtime, pty } = validRuntime();
    const process = createTerminalNativePtyFactory(runtime).create({ cols: 80, rows: 24 });
    const data = vi.fn();
    const exit = vi.fn();

    process.write("pwd\r");
    process.onData(data).dispose();
    process.onExit(exit).dispose();
    process.kill();

    expect(process.pid).toBe(123);
    expect(pty.write).toHaveBeenCalledWith("pwd\r");
    expect(pty.onData).toHaveBeenCalledWith(data);
    expect(pty.onExit).toHaveBeenCalledWith(exit);
    expect(pty.kill).toHaveBeenCalledWith("SIGHUP");
  });

  it("fails closed if native spawn returns an invalid PID", () => {
    const pty = fakePty(1);
    const { runtime } = validRuntime({ loadNodePty: () => ({ spawn: () => pty }) });
    expect(() => createTerminalNativePtyFactory(runtime).create({ cols: 80, rows: 24 })).toThrow(
      TerminalNativePtyUnavailableError,
    );
    expect(pty.kill).toHaveBeenCalledWith("SIGHUP");
  });
});
