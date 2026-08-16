import { setTimeout as delay } from "node:timers/promises";

import { loadLinuxTerminalPtyFactory } from "../src/terminal-native-pty.js";

const MARKER = "__DASHBOARD_RPI5_NATIVE_PTY_OK__";
const factory = loadLinuxTerminalPtyFactory();
const pty = factory.create({ cols: 80, rows: 24 });

let output = "";
let exitCode: number | undefined;
let exitSignal: number | undefined;
let exited = false;

const dataDisposable = pty.onData((data) => {
  output += data;
});
const exitDisposable = pty.onExit((event) => {
  exitCode = event.exitCode;
  exitSignal = event.signal;
  exited = true;
});

try {
  pty.write(`printf '${MARKER}\\n'\r`);
  pty.write("exit\r");

  for (let attempt = 0; attempt < 100 && !exited; attempt += 1) {
    await delay(50);
  }

  if (!exited) {
    pty.kill();
    throw new Error("native PTY smoke timed out");
  }
  if (!output.includes(MARKER)) {
    throw new Error("native PTY marker missing");
  }
  if (exitCode !== 0) {
    throw new Error(`native PTY exited unexpectedly: code=${String(exitCode)} signal=${String(exitSignal)}`);
  }

  console.log(`native PTY smoke PASS (${process.platform}/${process.arch})`);
} finally {
  dataDisposable.dispose();
  exitDisposable.dispose();
}
