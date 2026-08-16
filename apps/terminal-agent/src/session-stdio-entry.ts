import process from "node:process";

import { runTerminalLocalSession } from "./local-session.js";

try {
  await runTerminalLocalSession({
    input: process.stdin,
    output: process.stdout,
  });
} catch {
  // Fail closed without reflecting terminal/session contents into service logs.
  process.exitCode = 1;
}
