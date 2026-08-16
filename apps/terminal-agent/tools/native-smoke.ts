import { setTimeout as delay } from "node:timers/promises";

import * as nodePty from "node-pty";

const MARKER = "__DASHBOARD_RPI5_NATIVE_PTY_OK__";
const pty = nodePty.spawn(
  "/bin/bash",
  ["--noprofile", "--norc", "-c", `printf '${MARKER}\\n'`],
  {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: {
      HOME: process.cwd(),
      USER: "native-smoke",
      LOGNAME: "native-smoke",
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
    throw new Error("native PTY smoke timed out");
  }
  if (!output.includes(MARKER)) {
    throw new Error("native PTY marker missing");
  }
  if (exitCode !== 0) {
    throw new Error(`native PTY exited unexpectedly: ${String(exitCode)}`);
  }
  console.log(`native PTY binding PASS (${process.platform}/${process.arch})`);
} finally {
  dataDisposable.dispose();
  exitDisposable.dispose();
}
