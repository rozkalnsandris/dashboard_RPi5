import { readFile } from "node:fs/promises";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PATH = resolve(ROOT, "ops/production/host-readiness-contract.json");
export const NODE_RUNTIME_READINESS_SCHEMA = "dashboard-rpi5.node-runtime-readiness.v1";

function parseVersion(value, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(String(value));
  if (match === null) throw new Error(`${label} must be a semantic Node version`);
  return match.slice(1, 4).map((part) => Number.parseInt(part, 10));
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function assertProductionNodeRuntime({ platform, arch, nodeVersion, execPath, contract }) {
  const runtime = contract?.runtime;
  if (typeof runtime !== "object" || runtime === null || Array.isArray(runtime)) {
    throw new Error("host readiness runtime contract is missing");
  }
  if (platform !== runtime.platform) throw new Error("production host platform mismatch");
  if (arch !== runtime.arch) throw new Error("production host architecture mismatch");
  if (execPath !== runtime.nodeExecPath) throw new Error("production host Node executable path mismatch");

  const actual = parseVersion(nodeVersion, "production host Node version");
  const minimum = parseVersion(runtime.nodeMinimum, "host readiness nodeMinimum");
  if (actual[0] !== runtime.nodeMajor) throw new Error("production host Node major mismatch");
  if (minimum[0] !== runtime.nodeMajor) throw new Error("host readiness Node minimum/major contract mismatch");
  if (compareVersions(actual, minimum) < 0) {
    throw new Error(`production host Node version ${nodeVersion} is below reviewed minimum ${runtime.nodeMinimum}`);
  }

  return {
    schema: NODE_RUNTIME_READINESS_SCHEMA,
    status: "PASS",
    platform,
    arch,
    nodeVersion,
    nodeMinimum: runtime.nodeMinimum,
    nodeExecPath: execPath,
    mutationAllowed: false,
  };
}

async function main() {
  const contract = JSON.parse(await readFile(CONTRACT_PATH, "utf8"));
  const result = assertProductionNodeRuntime({
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    execPath: process.execPath,
    contract,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
