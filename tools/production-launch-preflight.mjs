import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const PRODUCTION_CONTRACT_PATH = "ops/production/launch-contract.json";
export const WEB_UNIT_PATH = "ops/systemd/dashboard-rpi5-web.service";
export const AGENT_UNIT_PATH = "ops/systemd/dashboard-rpi5-agent.service";
export const TERMINAL_SOCKET_PATH = "ops/systemd/dashboard-rpi5-terminal.socket";
export const TERMINAL_SERVICE_PATH = "ops/systemd/dashboard-rpi5-terminal@.service";
export const WEB_ENV_EXAMPLE_PATH = "ops/production/web.env.example";

const FULL_SHA = /^[0-9a-f]{40}$/;
const SUPPORTED_ARCHES = new Set(["x64", "arm64"]);
const REQUIRED_RELEASE_FILES = [
  "apps/web/dist/index.html",
  "apps/server/dist/index.js",
  "apps/agent/dist/index.js",
  "apps/terminal-agent/dist/session-stdio-entry.js",
  PRODUCTION_CONTRACT_PATH,
  WEB_UNIT_PATH,
  AGENT_UNIT_PATH,
  TERMINAL_SOCKET_PATH,
  TERMINAL_SERVICE_PATH,
  WEB_ENV_EXAMPLE_PATH,
];

function fail(errors, message) {
  errors.push(message);
}

function requireEqual(errors, actual, expected, label) {
  if (actual !== expected) fail(errors, `${label} must equal ${expected}`);
}

function requireIncludes(errors, text, expected, label) {
  if (!text.includes(expected)) fail(errors, `${label} must contain ${expected}`);
}

function requireExcludes(errors, text, forbidden, label) {
  if (text.includes(forbidden)) fail(errors, `${label} must not contain ${forbidden}`);
}

function readObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

export function validateRuntime({ platform, arch, nodeVersion }) {
  const errors = [];
  if (platform !== "linux") fail(errors, "production runtime must be linux");
  if (!SUPPORTED_ARCHES.has(arch)) fail(errors, "production architecture must be x64 or arm64");
  const major = Number.parseInt(String(nodeVersion).split(".")[0] ?? "", 10);
  if (major !== 24) fail(errors, "production Node.js major must be 24");
  return errors;
}

export function validateReleasePath(releasePath, expectedSha) {
  const errors = [];
  if (!FULL_SHA.test(expectedSha)) {
    fail(errors, "expected SHA must be 40 lowercase hex characters");
    return errors;
  }
  const expectedPath = `/opt/dashboard_RPi5/releases/${expectedSha}`;
  if (resolve(releasePath) !== expectedPath) {
    fail(errors, `release path must be ${expectedPath}`);
  }
  return errors;
}

export function validateProductionContract(value) {
  const errors = [];
  const root = readObject(value);
  if (root === null) return ["production contract must be an object"];
  requireEqual(errors, root.schema, "dashboard-rpi5.production-launch.v1", "contract schema");

  const release = readObject(root.release);
  const web = readObject(root.web);
  const agent = readObject(root.agent);
  const terminal = readObject(root.terminal);
  if (release === null || web === null || agent === null || terminal === null) {
    return [...errors, "production contract sections are incomplete"];
  }

  requireEqual(errors, release.root, "/opt/dashboard_RPi5/releases", "release root");
  requireEqual(errors, release.current, "/opt/dashboard_RPi5/current", "current release link");
  requireEqual(errors, release.configDir, "/etc/dashboard-rpi5", "config directory");

  requireEqual(errors, web.user, "dashboard-rpi5-web", "web user");
  requireEqual(errors, web.group, "dashboard-rpi5-web", "web group");
  requireEqual(errors, web.agentClientGroup, "dashboard-rpi5-agent-client", "agent client group");
  requireEqual(errors, web.terminalClientGroup, "dashboard-rpi5-terminal-client", "terminal client group");
  requireEqual(errors, web.host, "127.0.0.1", "web bind host");
  requireEqual(errors, web.port, 8787, "web port");
  requireEqual(errors, web.webRoot, "/opt/dashboard_RPi5/current/apps/web/dist", "web root");
  requireEqual(errors, web.agentSocket, "/run/dashboard-rpi5/agent.sock", "agent socket");
  requireEqual(errors, web.terminalEnabledByDefault, false, "terminal default gate");

  requireEqual(errors, agent.user, "dashboard-rpi5-agent", "agent user");
  requireEqual(errors, agent.group, "dashboard-rpi5-agent-client", "agent primary group");
  requireEqual(errors, agent.socket, "/run/dashboard-rpi5/agent.sock", "agent socket");
  requireEqual(errors, agent.quickCommandsEnabledByDefault, false, "Quick Commands default gate");

  requireEqual(errors, terminal.user, "dashboard-rpi5-terminal", "terminal user");
  requireEqual(errors, terminal.group, "dashboard-rpi5-terminal", "terminal group");
  requireEqual(errors, terminal.clientGroup, "dashboard-rpi5-terminal-client", "terminal client group");
  requireEqual(errors, terminal.socket, "/run/dashboard-rpi5-terminal.sock", "terminal socket");
  requireEqual(errors, terminal.socketMode, "0660", "terminal socket mode");
  requireEqual(errors, terminal.maxConnections, 1, "terminal max connections");
  requireEqual(errors, terminal.runtimeMaxSeconds, 1800, "terminal runtime maximum");
  requireEqual(errors, terminal.idleMaxSeconds, 300, "terminal idle maximum");

  const users = [web.user, agent.user, terminal.user];
  if (new Set(users).size !== users.length) fail(errors, "web, agent and terminal users must be distinct");
  if (agent.group === terminal.clientGroup) fail(errors, "read-agent group must not equal terminal client group");
  if (terminal.group === terminal.clientGroup) fail(errors, "terminal worker group must not equal terminal client group");

  return errors;
}

export function validateBlueprintTexts({ webUnit, agentUnit, terminalSocket, terminalService, webEnv }) {
  const errors = [];

  requireIncludes(errors, webUnit, "User=dashboard-rpi5-web", "web unit");
  requireIncludes(errors, webUnit, "Group=dashboard-rpi5-web", "web unit");
  requireIncludes(errors, webUnit, "SupplementaryGroups=dashboard-rpi5-agent-client", "web unit");
  requireExcludes(errors, webUnit, "SupplementaryGroups=dashboard-rpi5-terminal-client", "base web unit");
  requireIncludes(errors, webUnit, "WorkingDirectory=/opt/dashboard_RPi5/current", "web unit");
  requireIncludes(errors, webUnit, "ExecStart=/usr/bin/node /opt/dashboard_RPi5/current/apps/server/dist/index.js", "web unit");
  requireIncludes(errors, webUnit, "EnvironmentFile=/etc/dashboard-rpi5/web.env", "web unit");
  requireExcludes(errors, webUnit, "0.0.0.0", "web unit");

  requireIncludes(errors, agentUnit, "User=dashboard-rpi5-agent", "agent unit");
  requireIncludes(errors, agentUnit, "Group=dashboard-rpi5-agent-client", "agent unit");
  requireIncludes(errors, agentUnit, "DASHBOARD_RPI5_QUICK_COMMANDS=disabled", "agent unit");
  requireIncludes(errors, agentUnit, "ExecStart=/usr/bin/node /opt/dashboard_RPi5/current/apps/agent/dist/index.js", "agent unit");
  requireExcludes(errors, agentUnit, "dashboard-rpi5-terminal-client", "agent unit");

  const listenLines = terminalSocket
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("ListenStream="));
  if (listenLines.length !== 1 || listenLines[0] !== "ListenStream=/run/dashboard-rpi5-terminal.sock") {
    fail(errors, "terminal socket must expose exactly one fixed Unix ListenStream");
  }
  requireIncludes(errors, terminalSocket, "SocketGroup=dashboard-rpi5-terminal-client", "terminal socket");
  requireIncludes(errors, terminalSocket, "SocketMode=0660", "terminal socket");
  requireIncludes(errors, terminalSocket, "Accept=yes", "terminal socket");
  requireIncludes(errors, terminalSocket, "MaxConnections=1", "terminal socket");

  requireIncludes(errors, terminalService, "User=dashboard-rpi5-terminal", "terminal service");
  requireIncludes(errors, terminalService, "Group=dashboard-rpi5-terminal", "terminal service");
  if (!terminalService.split(/\r?\n/u).some((line) => line.trim() === "SupplementaryGroups=")) {
    fail(errors, "terminal service must explicitly clear supplementary groups");
  }
  requireIncludes(errors, terminalService, "ExecStart=/usr/bin/node /opt/dashboard_RPi5/current/apps/terminal-agent/dist/session-stdio-entry.js", "terminal service");
  requireIncludes(errors, terminalService, "KillMode=control-group", "terminal service");
  requireIncludes(errors, terminalService, "SendSIGKILL=yes", "terminal service");
  requireIncludes(errors, terminalService, "RuntimeMaxSec=30min", "terminal service");
  requireIncludes(errors, terminalService, "ProtectControlGroups=yes", "terminal service");
  requireIncludes(errors, terminalService, "PrivateNetwork=yes", "terminal service");
  requireIncludes(errors, terminalService, "RestrictAddressFamilies=AF_UNIX", "terminal service");
  requireExcludes(errors, terminalService, "Delegate=", "terminal service");

  requireIncludes(errors, webEnv, "PORT=8787", "base web environment");
  requireIncludes(errors, webEnv, "DASHBOARD_WEB_ROOT=/opt/dashboard_RPi5/current/apps/web/dist", "base web environment");
  requireIncludes(errors, webEnv, "DASHBOARD_AGENT_SOCKET_PATH=/run/dashboard-rpi5/agent.sock", "base web environment");
  requireIncludes(errors, webEnv, "DASHBOARD_TERMINAL_ENABLED=disabled", "base web environment");
  requireExcludes(errors, webEnv, "DASHBOARD_TERMINAL_ENABLED=enabled", "base web environment");

  return errors;
}

export async function validateRepositoryBlueprints(rootDir) {
  const [contractText, webUnit, agentUnit, terminalSocket, terminalService, webEnv] = await Promise.all([
    readFile(resolve(rootDir, PRODUCTION_CONTRACT_PATH), "utf8"),
    readFile(resolve(rootDir, WEB_UNIT_PATH), "utf8"),
    readFile(resolve(rootDir, AGENT_UNIT_PATH), "utf8"),
    readFile(resolve(rootDir, TERMINAL_SOCKET_PATH), "utf8"),
    readFile(resolve(rootDir, TERMINAL_SERVICE_PATH), "utf8"),
    readFile(resolve(rootDir, WEB_ENV_EXAMPLE_PATH), "utf8"),
  ]);

  let contract;
  try {
    contract = JSON.parse(contractText);
  } catch {
    return ["production contract JSON is invalid"];
  }

  return [
    ...validateProductionContract(contract),
    ...validateBlueprintTexts({ webUnit, agentUnit, terminalSocket, terminalService, webEnv }),
  ];
}

export async function preflightCandidateRelease({ releasePath, expectedSha }) {
  const errors = [
    ...validateRuntime({ platform: process.platform, arch: process.arch, nodeVersion: process.versions.node }),
    ...validateReleasePath(releasePath, expectedSha),
  ];
  if (errors.length > 0) return errors;

  let releaseStat;
  try {
    releaseStat = await stat(releasePath);
  } catch {
    return ["candidate release directory is unavailable"];
  }
  if (!releaseStat.isDirectory()) return ["candidate release path must be a directory"];

  for (const relativePath of REQUIRED_RELEASE_FILES) {
    try {
      const fileStat = await stat(resolve(releasePath, relativePath));
      if (!fileStat.isFile()) fail(errors, `required release artifact is not a file: ${relativePath}`);
    } catch {
      fail(errors, `required release artifact is missing: ${relativePath}`);
    }
  }
  if (errors.length > 0) return errors;

  return validateRepositoryBlueprints(releasePath);
}

function parseCli(argv) {
  const args = [...argv];
  let releasePath;
  let expectedSha;
  while (args.length > 0) {
    const key = args.shift();
    const value = args.shift();
    if (value === undefined) throw new Error("missing CLI value");
    if (key === "--release") releasePath = value;
    else if (key === "--sha") expectedSha = value;
    else throw new Error("unknown CLI argument");
  }
  if (releasePath === undefined || expectedSha === undefined) {
    throw new Error("usage: node tools/production-launch-preflight.mjs --release <path> --sha <40-hex-sha>");
  }
  return { releasePath, expectedSha };
}

async function main() {
  let input;
  try {
    input = parseCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "invalid arguments");
    process.exitCode = 2;
    return;
  }

  const errors = await preflightCandidateRelease(input);
  if (errors.length > 0) {
    console.error(JSON.stringify({ status: "BLOCKED", errors }));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({ status: "PASS", sha: input.expectedSha }));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
