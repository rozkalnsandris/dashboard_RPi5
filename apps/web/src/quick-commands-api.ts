import type {
  QuickCommandCatalog,
  QuickCommandId,
  QuickCommandResult,
} from "@dashboard-rpi5/contracts/quick-commands";

const VALID_IDS = new Set<QuickCommandId>([
  "host.uptime",
  "host.kernel",
  "host.disk-root",
  "host.failed-units",
]);

export class QuickCommandRequestError extends Error {
  constructor(readonly kind: "SOURCE_UNAVAILABLE" | "OPERATION_TIMEOUT") {
    super(kind === "OPERATION_TIMEOUT" ? "Quick command timed out" : "Quick command source unavailable");
    this.name = "QuickCommandRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseId(value: unknown): QuickCommandId {
  if (typeof value !== "string" || !VALID_IDS.has(value as QuickCommandId)) throw new Error("Invalid quick command response");
  return value as QuickCommandId;
}

function parseCatalog(value: unknown): QuickCommandCatalog {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "commands") || !Array.isArray(value.commands) || value.commands.length < 1 || value.commands.length > 4) throw new Error("Invalid quick command response");
  const seen = new Set<QuickCommandId>();
  return {
    commands: value.commands.map((item) => {
      if (!isRecord(item) || Object.keys(item).some((key) => !["id", "label", "description"].includes(key)) || typeof item.label !== "string" || typeof item.description !== "string") throw new Error("Invalid quick command response");
      const id = parseId(item.id);
      if (seen.has(id)) throw new Error("Invalid quick command response");
      seen.add(id);
      return { id, label: item.label, description: item.description };
    }),
  };
}

function parseResult(value: unknown): QuickCommandResult {
  if (!isRecord(value) || Object.keys(value).some((key) => !["commandId", "status", "startedAt", "finishedAt", "durationMs", "exitCode", "stdout", "stderr"].includes(key)) || (value.status !== "SUCCESS" && value.status !== "FAILED") || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt)) || typeof value.finishedAt !== "string" || !Number.isFinite(Date.parse(value.finishedAt)) || typeof value.durationMs !== "number" || !Number.isSafeInteger(value.durationMs) || value.durationMs < 0 || value.durationMs > 30_000 || (value.exitCode !== null && (typeof value.exitCode !== "number" || !Number.isSafeInteger(value.exitCode) || value.exitCode < 0 || value.exitCode > 255)) || typeof value.stdout !== "string" || value.stdout.length > 16_384 || typeof value.stderr !== "string" || value.stderr.length > 16_384) throw new Error("Invalid quick command response");
  return {
    commandId: parseId(value.commandId),
    status: value.status,
    startedAt: new Date(value.startedAt).toISOString(),
    finishedAt: new Date(value.finishedAt).toISOString(),
    durationMs: value.durationMs,
    exitCode: value.exitCode as number | null,
    stdout: value.stdout,
    stderr: value.stderr,
  };
}

async function parseError(response: Response): Promise<never> {
  if (response.status === 504) throw new QuickCommandRequestError("OPERATION_TIMEOUT");
  throw new QuickCommandRequestError("SOURCE_UNAVAILABLE");
}

export async function fetchQuickCommandCatalog(signal?: AbortSignal): Promise<QuickCommandCatalog> {
  const response = await fetch("/api/quick-commands", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) return parseError(response);
  return parseCatalog(await response.json());
}

export async function runQuickCommand(commandId: QuickCommandId, signal?: AbortSignal): Promise<QuickCommandResult> {
  const response = await fetch("/api/quick-commands/run", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ commandId }),
    cache: "no-store",
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) return parseError(response);
  return parseResult(await response.json());
}
