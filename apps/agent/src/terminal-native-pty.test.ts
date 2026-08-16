import { describe, expect, it, vi } from "vitest";

import {
  createLinuxTerminalPtyFactory,
  TERMINAL_NATIVE_LANG,
  TERMINAL_NATIVE_PATH,
  TERMINAL_NATIVE_SHELL,
  TERMINAL_NATIVE_SHELL_ARGS,
  TERMINAL_NATIVE_TERM,
  TerminalNativePtyUnavailableError,
} from "./terminal-native-pty.js";

function fakePty() {
  return {
    pid: 123,
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

function validRuntime(overrides: Record<string, unknown> = {}) {
  const pty = fakePty();
  const spawn = vi.fn(() => pty);
  const runtime = {
    platform: "linux" as NodeJS.Platform,
    arch: "arm64",
    getEffectiveUid: () => 1000,
    getEffectiveGid: () => 1000,
    getUserInfo: () => ({
      username: "dashboard",
      uid: 1000,
      gid: 1000,
      homedir: "/home/dashboard",
    }),
    loadNodePty: () => ({ spawn }),
    ...overrides,
  };
  return { runtime, pty, spawn };
}

describe("native Linux PTY adapter", () => {
  it("refuses non-Linux, unsupported architecture and effective root before native load", () => {
    for (const overrides of [
      { platform: "darwin" as NodeJS.Platform },
      { arch: "riscv64" },
      { getEffectiveUid: () => 0 },
      { getEffectiveUid: () => undefined },
    ]) {
      const loadNodePty = vi.fn(() => ({ spawn: vi.fn() }));
      const { runtime } = validRuntime({ ...overrides, loadNodePty });

      expect(() => createLinuxTerminalPtyFactory(runtime)).toThrow(
        TerminalNativePtyUnavailableError,
      );
      expect(loadNodePty).not.toHaveBeenCalled();
    }
  });

  it("refuses mismatched or unsafe effective user metadata before native load", () => {
    for (const getUserInfo of [
      () => ({ username: "dashboard", uid: 1001, gid: 1000, homedir: "/home/dashboard" }),
      () => ({ username: "dashboard", uid: 1000, gid: 1001, homedir: "/home/dashboard" }),
      () => ({ username: "", uid: 1000, gid: 1000, homedir: "/home/dashboard" }),
      () => ({ username: "dashboard", uid: 1000, gid: 1000, homedir: "relative/home" }),
    ]) {
      const loadNodePty = vi.fn(() => ({ spawn: vi.fn() }));
      const { runtime } = validRuntime({ getUserInfo, loadNodePty });

      expect(() => createLinuxTerminalPtyFactory(runtime)).toThrow(
        TerminalNativePtyUnavailableError,
      );
      expect(loadNodePty).not.toHaveBeenCalled();
    }
  });

  it("spawns only the fixed shell contract with a fresh allowlisted environment", () => {
    const { runtime, spawn } = validRuntime();
    const factory = createLinuxTerminalPtyFactory(runtime);

    factory.create({ cols: 100, rows: 30 });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(TERMINAL_NATIVE_SHELL, [...TERMINAL_NATIVE_SHELL_ARGS], {
      name: TERMINAL_NATIVE_TERM,
      cols: 100,
      rows: 30,
      cwd: "/home/dashboard",
      env: {
        HOME: "/home/dashboard",
        USER: "dashboard",
        LOGNAME: "dashboard",
        SHELL: TERMINAL_NATIVE_SHELL,
        PATH: TERMINAL_NATIVE_PATH,
        TERM: TERMINAL_NATIVE_TERM,
        COLORTERM: "truecolor",
        LANG: TERMINAL_NATIVE_LANG,
      },
      encoding: "utf8",
      handleFlowControl: false,
    });

    const options = spawn.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(options).not.toHaveProperty("uid");
    expect(options).not.toHaveProperty("gid");
    expect(Object.keys(options.env as Record<string, string>).sort()).toEqual(
      ["COLORTERM", "HOME", "LANG", "LOGNAME", "PATH", "SHELL", "TERM", "USER"].sort(),
    );
  });

  it("delegates only write, resize, fixed SIGHUP kill and disposable events", () => {
    const { runtime, pty } = validRuntime();
    const process = createLinuxTerminalPtyFactory(runtime).create({ cols: 80, rows: 24 });
    const data = vi.fn();
    const exit = vi.fn();

    process.write("pwd\r");
    process.resize(120, 40);
    const dataDisposable = process.onData(data);
    const exitDisposable = process.onExit(exit);
    process.kill();
    dataDisposable.dispose();
    exitDisposable.dispose();

    expect(pty.write).toHaveBeenCalledWith("pwd\r");
    expect(pty.resize).toHaveBeenCalledWith(120, 40);
    expect(pty.kill).toHaveBeenCalledWith("SIGHUP");
    expect(pty.onData).toHaveBeenCalledWith(data);
    expect(pty.onExit).toHaveBeenCalledWith(exit);
  });
});
