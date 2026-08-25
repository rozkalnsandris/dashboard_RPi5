import { createRequire } from "node:module";
import { userInfo } from "node:os";
import { isAbsolute } from "node:path";
import process from "node:process";

import type { IDisposable, IPty } from "node-pty";

export const TERMINAL_NATIVE_SHELL = "/bin/bash" as const;
export const TERMINAL_NATIVE_SHELL_ARGS = Object.freeze(["--noprofile", "--norc"] as const);
export const TERMINAL_NATIVE_TERM = "xterm-256color" as const;
export const TERMINAL_NATIVE_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" as const;
export const TERMINAL_NATIVE_LANG = "C.UTF-8" as const;
export const TERMINAL_NATIVE_MIN_COLS = 2;
export const TERMINAL_NATIVE_MAX_COLS = 300;
export const TERMINAL_NATIVE_MIN_ROWS = 2;
export const TERMINAL_NATIVE_MAX_ROWS = 200;
export const TERMINAL_NATIVE_SUPPORTED_ARCHES = Object.freeze(["x64", "arm64"] as const);
export const TERMINAL_NATIVE_PACKAGED_MODULE = "./native/node-pty" as const;

export interface TerminalNativePtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): {
    dispose(): void;
  };
}

export interface TerminalNativePtyFactory {
  create(options: { cols: number; rows: number }): TerminalNativePtyProcess;
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

export interface TerminalNativeRuntime {
  platform: NodeJS.Platform;
  arch: string;
  getEffectiveUid(): number | undefined;
  getEffectiveGid(): number | undefined;
  getGroups(): readonly number[] | undefined;
  getUserInfo(): {
    username: string;
    uid: number;
    gid: number;
    homedir: string;
  };
  loadNodePty(): NodePtyModule;
}

export class TerminalNativePtyUnavailableError extends Error {
  constructor() {
    super("Native terminal PTY is unavailable");
    this.name = "TerminalNativePtyUnavailableError";
  }
}

export class TerminalNativePtyInputError extends Error {
  constructor() {
    super("Native terminal PTY dimensions are invalid");
    this.name = "TerminalNativePtyInputError";
  }
}

export function loadTerminalNativePtyFactory(): TerminalNativePtyFactory {
  return createTerminalNativePtyFactory(defaultRuntime());
}

export function createTerminalNativePtyFactory(
  runtime: TerminalNativeRuntime,
): TerminalNativePtyFactory {
  const identity = validateRuntime(runtime);

  // Native code is loaded only after platform, identity and group checks pass.
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
    PWD: identity.homedir,
  });

  return {
    create({ cols, rows }) {
      validateDimensions(cols, rows);
      const pty = nodePty.spawn(TERMINAL_NATIVE_SHELL, [...TERMINAL_NATIVE_SHELL_ARGS], {
        name: TERMINAL_NATIVE_TERM,
        cols,
        rows,
        cwd: identity.homedir,
        env: { ...environment },
        encoding: "utf8",
        handleFlowControl: false,
      });
      if (!Number.isInteger(pty.pid) || pty.pid <= 1) {
        try {
          pty.kill("SIGHUP");
        } catch {
          // The malformed native process is already unusable.
        }
        throw new TerminalNativePtyUnavailableError();
      }
      return wrapPty(pty);
    },
  };
}

function validateRuntime(runtime: TerminalNativeRuntime) {
  if (
    runtime.platform !== "linux" ||
    !TERMINAL_NATIVE_SUPPORTED_ARCHES.includes(runtime.arch as "x64" | "arm64")
  ) {
    throw new TerminalNativePtyUnavailableError();
  }

  const effectiveUid = runtime.getEffectiveUid();
  const effectiveGid = runtime.getEffectiveGid();
  const groups = runtime.getGroups();
  if (
    effectiveUid === undefined ||
    effectiveGid === undefined ||
    groups === undefined ||
    !Number.isInteger(effectiveUid) ||
    !Number.isInteger(effectiveGid) ||
    effectiveUid <= 0 ||
    effectiveGid <= 0 ||
    !hasOnlyPrimaryGroup(groups, effectiveGid)
  ) {
    throw new TerminalNativePtyUnavailableError();
  }

  const identity = runtime.getUserInfo();
  if (
    identity.uid !== effectiveUid ||
    identity.gid !== effectiveGid ||
    !/^[A-Za-z0-9._-]+$/.test(identity.username) ||
    identity.homedir.length === 0 ||
    identity.homedir === "/" ||
    identity.homedir.includes("\0") ||
    !isAbsolute(identity.homedir)
  ) {
    throw new TerminalNativePtyUnavailableError();
  }

  return identity;
}

function hasOnlyPrimaryGroup(groups: readonly number[], effectiveGid: number): boolean {
  if (groups.length === 0) return false;
  const normalized = new Set<number>();
  for (const group of groups) {
    if (!Number.isInteger(group) || group < 0) return false;
    normalized.add(group);
  }
  return normalized.size === 1 && normalized.has(effectiveGid);
}

function validateDimensions(cols: number, rows: number): void {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < TERMINAL_NATIVE_MIN_COLS ||
    cols > TERMINAL_NATIVE_MAX_COLS ||
    rows < TERMINAL_NATIVE_MIN_ROWS ||
    rows > TERMINAL_NATIVE_MAX_ROWS
  ) {
    throw new TerminalNativePtyInputError();
  }
}

function wrapPty(pty: IPty): TerminalNativePtyProcess {
  return {
    pid: pty.pid,
    write(data) {
      pty.write(data);
    },
    resize(cols, rows) {
      validateDimensions(cols, rows);
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
  return { dispose: () => disposable.dispose() };
}

function defaultRuntime(): TerminalNativeRuntime {
  const require = createRequire(import.meta.url);
  return {
    platform: process.platform,
    arch: process.arch,
    getEffectiveUid: () => process.geteuid?.(),
    getEffectiveGid: () => process.getegid?.(),
    getGroups: () => process.getgroups?.(),
    getUserInfo: () => userInfo(),
    loadNodePty: () => require(TERMINAL_NATIVE_PACKAGED_MODULE) as NodePtyModule,
  };
}
