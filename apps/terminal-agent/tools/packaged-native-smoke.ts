import { createRequire } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import type { IPty } from "node-pty";

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

const MARKER = "__DASHBOARD_RPI5_PACKAGED_NATIVE_PTY_OK__";
const TOOL_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(TOOL_DIRECTORY, "../../..");
const TERMINAL_DIST = resolve(REPOSITORY_ROOT, "apps/terminal-agent/dist");
const PACKAGED_RUNTIME_ROOT = resolve(TERMINAL_DIST, "native/node-pty");
const requireFromDist = createRequire(resolve(TERMINAL_DIST, "session-stdio-entry.js"));
const resolvedModule = requireFromDist.resolve("./native/node-pty");

if (
  resolvedModule !== resolve(PACKAGED_RUNTIME_ROOT, "lib/index.js") &&
  !resolvedModule.startsWith(`${PACKAGED_RUNTIME_ROOT}${sep}`)
) {
  throw new Error(`packaged node-pty resolved outside immutable runtime: ${resolvedModule}`);
}

const nodePty = requireFromDist("./native/node-pty") as NodePtyModule;
if (typeof nodePty.spawn !== "function") {
  throw new Error("packaged node-pty spawn export is unavailable");
}

const pty = nodePty.spawn(
  "/bin/bash",
  ["--noprofile", "--norc", "-c", `printf '${MARKER}\\n'`],
  {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: REPOSITORY_ROOT,
    env: {
      HOME: REPOSITORY_ROOT,
      USER: "packaged-native-smoke",
      LOGNAME: "packaged-native-smoke",
      SHELL: "/bin/bash",
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      TERM: "xterm-256color",
      LANG: "C.UTF-8",
    },
    encoding: "utf8",
    handleFlowControl: false,
  },
);

let output = "";
let exitCode: number | undefined;
let exited = false;
const dataDisposable = pty.onData((data) => {
  output += data;
});
const exitDisposable = pty.onExit((event) => {
  exitCode = event.exitCode;
  exited = true;
});

try {
  for (let attempt = 0; attempt < 100 && !exited; attempt += 1) {
    await delay(50);
  }
  if (!exited) {
    pty.kill("SIGHUP");
    throw new Error("packaged native PTY smoke timed out");
  }
  if (!output.includes(MARKER)) {
    throw new Error("packaged native PTY marker missing");
  }
  if (exitCode !== 0) {
    throw new Error(`packaged native PTY exited unexpectedly: ${String(exitCode)}`);
  }
  console.log(`packaged native PTY runtime PASS (${process.platform}/${process.arch})`);
} finally {
  dataDisposable.dispose();
  exitDisposable.dispose();
}
