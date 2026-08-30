import type {
  QuickCommandCatalog,
  QuickCommandId,
  QuickCommandResult,
} from "@dashboard-rpi5/contracts/quick-commands";
import { spawn } from "node:child_process";

const MAX_OUTPUT_BYTES = 16 * 1024;
export const QUICK_COMMAND_TERMINATION_GRACE_MS = 250;

const COMMANDS = {
  "host.uptime": {
    label: "Uptime",
    description: "Human-readable host uptime",
    executable: "/usr/bin/uptime",
    args: ["--pretty"],
  },
  "host.kernel": {
    label: "Kernel",
    description: "Kernel release and machine architecture",
    executable: "/usr/bin/uname",
    args: ["-srmo"],
  },
  "host.disk-root": {
    label: "Root disk usage",
    description: "Bounded root filesystem usage summary",
    executable: "/usr/bin/df",
    args: ["-h", "--output=source,size,used,avail,pcent,target", "/"],
  },
  "host.failed-units": {
    label: "Failed services",
    description: "Systemd units currently in failed state",
    executable: "/usr/bin/systemctl",
    args: ["--failed", "--no-legend", "--plain", "--no-pager"],
  },
} as const satisfies Record<QuickCommandId, {
  label: string;
  description: string;
  executable: string;
  args: readonly string[];
}>;

export class QuickCommandSourceUnavailableError extends Error {
  constructor() {
    super("Quick command source unavailable");
    this.name = "QuickCommandSourceUnavailableError";
  }
}

export class QuickCommandOutputLimitError extends Error {
  constructor() {
    super("Quick command output exceeded limit");
    this.name = "QuickCommandOutputLimitError";
  }
}

export function listQuickCommands(): QuickCommandCatalog {
  return {
    commands: (Object.keys(COMMANDS) as QuickCommandId[]).map((id) => ({
      id,
      label: COMMANDS[id].label,
      description: COMMANDS[id].description,
    })),
  };
}

function isDisallowedControlCode(code: number): boolean {
  return (
    code <= 0x08 ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0e && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f)
  );
}

function sanitizeOutput(chunks: Buffer[]): string {
  const decoded = Buffer.concat(chunks).toString("utf8");
  return Array.from(decoded, (character) =>
    isDisallowedControlCode(character.charCodeAt(0)) ? "�" : character,
  ).join("").trimEnd();
}

export async function runQuickCommand(
  commandId: QuickCommandId,
  signal: AbortSignal,
): Promise<QuickCommandResult> {
  const spec = COMMANDS[commandId];
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(spec.executable, [...spec.args], {
        shell: false,
        env: {
          LANG: "C",
          LC_ALL: "C",
          SYSTEMD_COLORS: "0",
          SYSTEMD_PAGER: "cat",
        },
      });
    } catch {
      reject(new QuickCommandSourceUnavailableError());
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let totalBytes = 0;
    let closed = false;
    let terminalError: Error | undefined;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;

    const clearTerminationTimer = () => {
      if (terminationTimer !== undefined) {
        clearTimeout(terminationTimer);
        terminationTimer = undefined;
      }
    };

    const requestTermination = () => {
      if (closed) return;
      child.kill("SIGTERM");
      if (terminationTimer !== undefined) return;
      terminationTimer = setTimeout(() => {
        terminationTimer = undefined;
        if (!closed) {
          child.kill("SIGKILL");
        }
      }, QUICK_COMMAND_TERMINATION_GRACE_MS);
      terminationTimer.unref?.();
    };

    const onAbort = () => {
      requestTermination();
    };

    const capture = (target: Buffer[]) => (chunk: Buffer | string) => {
      if (closed || terminalError !== undefined) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MAX_OUTPUT_BYTES) {
        terminalError = new QuickCommandOutputLimitError();
        clearTerminationTimer();
        child.kill("SIGKILL");
        return;
      }
      target.push(buffer);
    };

    child.stdout.on("data", capture(stdout));
    child.stderr.on("data", capture(stderr));
    child.once("error", () => {
      terminalError ??= new QuickCommandSourceUnavailableError();
    });
    child.once("close", (code) => {
      closed = true;
      clearTerminationTimer();
      signal.removeEventListener("abort", onAbort);

      if (terminalError !== undefined) {
        reject(terminalError);
        return;
      }

      const finishedMs = Date.now();
      resolve({
        commandId,
        status: code === 0 ? "SUCCESS" : "FAILED",
        startedAt,
        finishedAt: new Date(finishedMs).toISOString(),
        durationMs: Math.min(30_000, Math.max(0, finishedMs - startedMs)),
        exitCode: code,
        stdout: sanitizeOutput(stdout),
        stderr: sanitizeOutput(stderr),
      });
    });

    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
