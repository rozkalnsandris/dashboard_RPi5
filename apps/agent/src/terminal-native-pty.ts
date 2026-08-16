import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import process from "node:process";
import { userInfo } from "node:os";

import type { IDisposable, IPty } from "node-pty";

export const TERMINAL_NATIVE_SHELL = "/bin/bash" as const;
export const TERMINAL_NATIVE_SHELL_ARGS = Object.freeze(["--noprofile", "--norc"] as const);
export const TERMINAL_NATIVE_TERM = "xterm-256color" as const;
export const TERMINAL_NATIVE_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" as const;
export const TERMINAL_NATIVE_LANG = "C.UTF-8" as const;
export const TERMINAL_NATIVE_SUPPORTED_ARCHES = Object.freeze(["x64", "arm64"] as const);

export interface AgentTerminalPtyProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): {
    dispose(): void;
  };
}

export interface AgentTerminalPtyFactory {
  create(options: { cols: number; rows: number }): AgentTerminalPtyProcess;
}

interface NodePtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string>;
      encoding: string;
      handleFlowControl: boolean;
    },
  ): IPty;
}

interface EffectiveUserInfo {
  username: string;
  uid: number;
  gid: number;
  homedir: string;
}

interface LinuxPtyRuntime {
  platform: NodeJS.Platform;
  arch: string;
  getEffectiveUid(): number | undefined;
  getEffectiveGid(): number | undefined;
  getUserInfo(): EffectiveUserInfo;
  loadNodePty(): NodePtyModule;
}

export class TerminalNativePtyUnavailableError extends Error {
  constructor(message = "Native terminal PTY is unavailable") {
    super(message);
    this.name = "TerminalNativePtyUnavailableError";
  }
}

export function loadLinuxTerminalPtyFactory(): AgentTerminalPtyFactory {
  return createLinuxTerminalPtyFactory(defaultRuntime());
}

export function createLinuxTerminalPtyFactory(
  runtime: LinuxPtyRuntime,
): AgentTerminalPtyFactory {
  if (runtime.platform !== "linux") {
    throw new TerminalNativePtyUnavailableError();
  }
  if (!TERMINAL_NATIVE_SUPPORTED_ARCHES.includes(runtime.arch as "x64" | "arm64")) {
    throw new TerminalNativePtyUnavailableError();
  }

  const effectiveUid = runtime.getEffectiveUid();
  const effectiveGid = runtime.getEffectiveGid();
  if (
    effectiveUid === undefined ||
    effectiveGid === undefined ||
    !Number.isInteger(effectiveUid) ||
    !Number.isInteger(effectiveGid) ||
    effectiveUid <= 0 ||
    effectiveGid < 0
  ) {
    throw new TerminalNativePtyUnavailableError();
  }

  const identity = runtime.getUserInfo();
  if (
    identity.uid !== effectiveUid ||
    identity.gid !== effectiveGid ||
    identity.username.length === 0 ||
    identity.homedir.length === 0 ||
    !isAbsolute(identity.homedir)
  ) {
    throw new TerminalNativePtyUnavailableError();
  }

  // Native code is loaded only after platform and privilege checks have passed.
  const nodePty = runtime.loadNodePty();
  const environment = Object.freeze({
    HOME: identity.homedir,
    USER: identity.username,
    LOGNAME: identity.username,
    SHELL: TERMINAL_NATIVE_SHELL,
    PATH: TERMINAL_NATIVE_PATH,
    TERM: TERMINAL_NATIVE_TERM,
    COLORTERM: "truecolor",
    LANG: TERMINAL_NATIVE_LANG,
  });

  return {
    create({ cols, rows }) {
      const pty = nodePty.spawn(TERMINAL_NATIVE_SHELL, [...TERMINAL_NATIVE_SHELL_ARGS], {
        name: TERMINAL_NATIVE_TERM,
        cols,
        rows,
        cwd: identity.homedir,
        env: { ...environment },
        encoding: "utf8",
        handleFlowControl: false,
      });

      return wrapPty(pty);
    },
  };
}

function wrapPty(pty: IPty): AgentTerminalPtyProcess {
  return {
    write(data) {
      pty.write(data);
    },
    resize(cols, rows) {
      pty.resize(cols, rows);
    },
    kill() {
      pty.kill("SIGHUP");
    },
    onData(listener) {
      return wrapDisposable(pty.onData(listener));
    },
    onExit(listener) {
      return wrapDisposable(pty.onExit(listener));
    },
  };
}

function wrapDisposable(disposable: IDisposable): { dispose(): void } {
  return {
    dispose() {
      disposable.dispose();
    },
  };
}

function defaultRuntime(): LinuxPtyRuntime {
  const require = createRequire(import.meta.url);
  return {
    platform: process.platform,
    arch: process.arch,
    getEffectiveUid: () => process.geteuid?.(),
    getEffectiveGid: () => process.getegid?.(),
    getUserInfo: () => userInfo(),
    loadNodePty: () => require("node-pty") as NodePtyModule,
  };
}
