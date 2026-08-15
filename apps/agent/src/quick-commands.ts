import type {
  QuickCommandCatalog,
  QuickCommandId,
  QuickCommandResult,
} from "@dashboard-rpi5/contracts/quick-commands";
import { spawn } from "node:child_process";

const MAX_OUTPUT_BYTES = 16 * 1024;

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

function sanitizeOutput(chunks: Buffer[]): string {
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "�")
    .trimEnd();
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
        signal,
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
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    const capture = (target: Buffer[]) => (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(() => reject(new QuickCommandOutputLimitError()));
        return;
      }
      target.push(buffer);
    };

    child.stdout.on("data", capture(stdout));
    child.stderr.on("data", capture(stderr));
    child.once("error", () => finish(() => reject(new QuickCommandSourceUnavailableError())));
    child.once("close", (code) => {
      const finishedMs = Date.now();
      finish(() => resolve({
        commandId,
        status: code === 0 ? "SUCCESS" : "FAILED",
        startedAt,
        finishedAt: new Date(finishedMs).toISOString(),
        durationMs: Math.min(30_000, Math.max(0, finishedMs - startedMs)),
        exitCode: code,
        stdout: sanitizeOutput(stdout),
        stderr: sanitizeOutput(stderr),
      }));
    });
  });
}
