import { Buffer } from "node:buffer";
import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HOST_READINESS_SCHEMA = "dashboard-rpi5.host-readiness.v1";

const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const UNIT_NAMES = Object.freeze([
  "dashboard-rpi5-web.service",
  "dashboard-rpi5-agent.service",
  "dashboard-rpi5-terminal.socket",
  "dashboard-rpi5-terminal@.service",
]);

function assertObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertString(value, label) {
  if (typeof value !== "string" || value === "") throw new Error(`${label} must be a non-empty string`);
  return value;
}

function assertAbsolutePath(value, label) {
  const path = assertString(value, label);
  if (!isAbsolute(path) || path.includes("\0")) throw new Error(`${label} must be an absolute path`);
  return path;
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry === "")) {
    throw new Error(`${label} must be a string array`);
  }
  return value;
}

function sameStringSet(left, right) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function hostPath(fsRoot, absolutePath) {
  assertAbsolutePath(absolutePath, "host evidence path");
  const root = resolve(fsRoot);
  const candidate = resolve(root, absolutePath.slice(1));
  const rel = relative(root, candidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("host evidence path escaped fixture root");
  return candidate;
}

async function pathState(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readBoundedText(path, label) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular non-symlink file`);
  const value = await readFile(path, "utf8");
  if (Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES) throw new Error(`${label} exceeds bounded evidence size`);
  return value;
}

function parseUnsignedInteger(value, label) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new Error(`${label} must be an unsigned integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is outside the safe integer range`);
  return parsed;
}

export function parsePasswd(text) {
  const users = new Map();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (line === "" || line.startsWith("#")) continue;
    const fields = line.split(":");
    if (fields.length !== 7 || fields[0] === "") throw new Error("passwd evidence is malformed");
    const name = fields[0];
    if (users.has(name)) throw new Error("passwd evidence contains duplicate user names");
    users.set(name, {
      name,
      uid: parseUnsignedInteger(fields[2], "passwd uid"),
      gid: parseUnsignedInteger(fields[3], "passwd gid"),
    });
  }
  return users;
}

export function parseGroup(text) {
  const groups = new Map();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (line === "" || line.startsWith("#")) continue;
    const fields = line.split(":");
    if (fields.length !== 4 || fields[0] === "") throw new Error("group evidence is malformed");
    const name = fields[0];
    if (groups.has(name)) throw new Error("group evidence contains duplicate group names");
    const members = fields[3] === "" ? [] : fields[3].split(",");
    if (members.some((member) => member === "")) throw new Error("group evidence contains an empty member");
    if (new Set(members).size !== members.length) throw new Error("group evidence contains duplicate members");
    groups.set(name, {
      name,
      gid: parseUnsignedInteger(fields[2], "group gid"),
      members,
    });
  }
  return groups;
}

export function parseProcNetTcp(text, expectedPort) {
  const portHex = expectedPort.toString(16).toUpperCase().padStart(4, "0");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0 || !lines[0].includes("local_address")) throw new Error("proc tcp evidence header is missing");
  for (const line of lines.slice(1)) {
    const fields = line.split(/\s+/u);
    if (fields.length < 4) throw new Error("proc tcp evidence row is malformed");
    const local = fields[1];
    const state = fields[3].toUpperCase();
    const match = /^[0-9A-Fa-f]{8}(?:[0-9A-Fa-f]{24})?:([0-9A-Fa-f]{4})$/u.exec(local);
    if (match === null || !/^[0-9A-F]{2}$/u.test(state)) throw new Error("proc tcp evidence row is malformed");
    if (state === "0A" && match[1].toUpperCase() === portHex) return true;
  }
  return false;
}

function expectedIdentityModel(launch) {
  return {
    users: [
      {
        name: launch.web.user,
        primaryGroup: launch.web.group,
        allowedSupplementaryGroups: [launch.web.agentClientGroup],
        forbiddenSupplementaryGroups: [launch.web.terminalClientGroup],
      },
      {
        name: launch.agent.user,
        primaryGroup: launch.agent.group,
        allowedSupplementaryGroups: [],
        forbiddenSupplementaryGroups: [launch.terminal.clientGroup],
      },
      {
        name: launch.terminal.user,
        primaryGroup: launch.terminal.group,
        allowedSupplementaryGroups: [],
        forbiddenSupplementaryGroups: [launch.web.agentClientGroup, launch.terminal.clientGroup],
      },
    ],
    groups: [launch.web.group, launch.web.agentClientGroup, launch.terminal.group, launch.terminal.clientGroup],
  };
}

function validateIdentityContract(contract, launch) {
  const expected = expectedIdentityModel(launch);
  if (!Array.isArray(contract.identityUsers) || contract.identityUsers.length !== expected.users.length) {
    throw new Error("host readiness identity user contract mismatch");
  }
  for (const expectedUser of expected.users) {
    const actual = contract.identityUsers.find((entry) => entry?.name === expectedUser.name);
    if (actual === undefined || actual.primaryGroup !== expectedUser.primaryGroup) throw new Error("host readiness identity primary group mismatch");
    if (!sameStringSet(assertStringArray(actual.allowedSupplementaryGroups, "allowed supplementary groups"), expectedUser.allowedSupplementaryGroups)) {
      throw new Error("host readiness allowed supplementary group mismatch");
    }
    if (!sameStringSet(assertStringArray(actual.forbiddenSupplementaryGroups, "forbidden supplementary groups"), expectedUser.forbiddenSupplementaryGroups)) {
      throw new Error("host readiness forbidden supplementary group mismatch");
    }
  }
  if (!sameStringSet(assertStringArray(contract.identityGroups, "identity groups"), expected.groups)) {
    throw new Error("host readiness identity group contract mismatch");
  }
}

export function validateHostReadinessContract(contractValue, launchValue) {
  const contract = assertObject(contractValue, "host readiness contract");
  const launch = assertObject(launchValue, "production launch contract");
  if (contract.schema !== HOST_READINESS_SCHEMA || contract.sourceOnly !== true || contract.mode !== "first-production-bootstrap") {
    throw new Error("host readiness schema/source boundary mismatch");
  }
  const runtime = assertObject(contract.runtime, "host readiness runtime");
  if (runtime.platform !== "linux" || runtime.arch !== "arm64" || runtime.nodeMajor !== 24 || runtime.nodeExecPath !== "/usr/bin/node" || runtime.initComm !== "systemd") {
    throw new Error("host readiness runtime contract mismatch");
  }
  const evidence = assertObject(contract.evidence, "host readiness evidence");
  const expectedEvidence = {
    passwd: "/etc/passwd",
    group: "/etc/group",
    tcp4: "/proc/net/tcp",
    tcp6: "/proc/net/tcp6",
    initComm: "/proc/1/comm",
    systemdRuntime: "/run/systemd/system",
  };
  for (const [key, expected] of Object.entries(expectedEvidence)) {
    if (evidence[key] !== expected) throw new Error("host readiness evidence path mismatch");
  }
  const paths = assertObject(contract.paths, "host readiness paths");
  if (paths.productionRoot !== "/opt/dashboard_RPi5" || paths.configDir !== launch.release.configDir || paths.agentRuntimeDirectory !== launch.agent.runtimeDirectory || paths.agentSocket !== launch.agent.socket || paths.terminalStateDirectory !== launch.terminal.stateDirectory || paths.terminalSocket !== launch.terminal.socket) {
    throw new Error("host readiness production path mismatch");
  }
  const port = assertObject(contract.port, "host readiness port");
  if (port.host !== launch.web.host || port.port !== launch.web.port || port.requireCompletelyFree !== true) {
    throw new Error("host readiness port contract mismatch");
  }
  validateIdentityContract(contract, launch);
  if (!Array.isArray(contract.units) || contract.units.length !== UNIT_NAMES.length) throw new Error("host readiness unit contract mismatch");
  if (!sameStringSet(contract.units.map((unit) => unit?.name), UNIT_NAMES)) throw new Error("host readiness unit names mismatch");
  for (const unit of contract.units) {
    assertString(unit.source, "unit source");
    assertAbsolutePath(unit.installed, "installed unit path");
    assertStringArray(unit.enablementLinks, "unit enablement links").forEach((link) => assertAbsolutePath(link, "unit enablement link"));
  }
  const capabilities = assertObject(contract.baseCapabilities, "host readiness capabilities");
  if (capabilities.quickCommands !== "disabled" || capabilities.terminal !== "disabled" || launch.agent.quickCommandsEnabledByDefault !== false || launch.web.terminalEnabledByDefault !== false) {
    throw new Error("host readiness base capability mismatch");
  }
  if (contract.mutationAllowed !== false || contract.networkAllowed !== false || contract.processExecutionAllowed !== false) {
    throw new Error("host readiness forbidden capability enabled");
  }
  return contract;
}

function assertRuntime(runtime, contract) {
  const nodeMajor = Number.parseInt(String(runtime.nodeVersion).split(".")[0], 10);
  if (runtime.platform !== contract.runtime.platform) throw new Error("production host platform mismatch");
  if (runtime.arch !== contract.runtime.arch) throw new Error("production host architecture mismatch");
  if (nodeMajor !== contract.runtime.nodeMajor) throw new Error("production host Node major mismatch");
  if (runtime.execPath !== contract.runtime.nodeExecPath) throw new Error("production host Node executable path mismatch");
}

function inspectIdentities(users, groups, contract) {
  const presentExpectedGroups = [];
  const seenGids = new Set();
  for (const groupName of contract.identityGroups) {
    const group = groups.get(groupName);
    if (group === undefined) continue;
    if (group.gid === 0) throw new Error("dashboard identity group collides with root gid");
    if (seenGids.has(group.gid)) throw new Error("dashboard identity groups share a gid");
    seenGids.add(group.gid);
    presentExpectedGroups.push(groupName);
  }

  const presentUsers = [];
  const seenUids = new Set();
  for (const model of contract.identityUsers) {
    const user = users.get(model.name);
    const supplementary = [];
    for (const group of groups.values()) {
      if (group.members.includes(model.name)) supplementary.push(group.name);
    }
    if (user === undefined) {
      if (supplementary.length > 0) throw new Error("absent dashboard user has stale supplementary group membership");
      continue;
    }
    if (user.uid === 0 || user.gid === 0) throw new Error("dashboard identity user collides with root identity");
    if (seenUids.has(user.uid)) throw new Error("dashboard identity users share a uid");
    seenUids.add(user.uid);
    const primary = groups.get(model.primaryGroup);
    if (primary === undefined || primary.gid !== user.gid) throw new Error("dashboard identity primary group mismatch on host");
    const allowed = new Set(model.allowedSupplementaryGroups);
    for (const groupName of supplementary) {
      if (!allowed.has(groupName)) throw new Error("dashboard identity has an unreviewed supplementary group");
    }
    for (const forbidden of model.forbiddenSupplementaryGroups) {
      if (supplementary.includes(forbidden)) throw new Error("dashboard identity has a forbidden capability group");
    }
    presentUsers.push(model.name);
  }

  return {
    users: presentUsers.length === 0 ? "absent-clean" : "present-compatible",
    groups: presentExpectedGroups.length === 0 ? "absent-clean" : "present-compatible",
    presentUserCount: presentUsers.length,
    presentGroupCount: presentExpectedGroups.length,
  };
}

async function assertOptionalDirectory(fsRoot, absolutePath, label) {
  const path = hostPath(fsRoot, absolutePath);
  const stat = await pathState(path);
  if (stat === null) return "absent";
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} exists with an unsafe filesystem type`);
  return "directory";
}

async function assertAbsentPath(fsRoot, absolutePath, label) {
  const stat = await pathState(hostPath(fsRoot, absolutePath));
  if (stat !== null) throw new Error(`${label} must be absent before base production bootstrap`);
}

async function inspectUnits(fsRoot, sourceRoot, contract) {
  let installedCount = 0;
  for (const unit of contract.units) {
    const sourcePath = resolve(sourceRoot, unit.source);
    const source = await readBoundedText(sourcePath, "source systemd unit");
    const installedPath = hostPath(fsRoot, unit.installed);
    const installedStat = await pathState(installedPath);
    if (installedStat !== null) {
      if (installedStat.isSymbolicLink() || !installedStat.isFile()) throw new Error("installed dashboard unit has an unsafe filesystem type");
      const installed = await readBoundedText(installedPath, "installed systemd unit");
      if (installed !== source) throw new Error("installed dashboard unit differs from reviewed source blueprint");
      installedCount += 1;
    }
    for (const link of unit.enablementLinks) {
      if ((await pathState(hostPath(fsRoot, link))) !== null) throw new Error("dashboard unit is already enabled before reviewed bootstrap");
    }
  }
  return installedCount === 0 ? "absent-clean" : "matching-disabled";
}

export async function verifyHostReadiness({ fsRoot, sourceRoot, runtime, contract: contractValue, launch: launchValue }) {
  const contract = validateHostReadinessContract(contractValue, launchValue);
  assertRuntime(runtime, contract);

  const initComm = (await readBoundedText(hostPath(fsRoot, contract.evidence.initComm), "init process evidence")).trim();
  if (initComm !== contract.runtime.initComm) throw new Error("production host init process mismatch");
  const systemdRuntime = await pathState(hostPath(fsRoot, contract.evidence.systemdRuntime));
  if (systemdRuntime === null || systemdRuntime.isSymbolicLink() || !systemdRuntime.isDirectory()) {
    throw new Error("systemd runtime directory is unavailable");
  }

  const passwd = await readBoundedText(hostPath(fsRoot, contract.evidence.passwd), "passwd evidence");
  const group = await readBoundedText(hostPath(fsRoot, contract.evidence.group), "group evidence");
  const identity = inspectIdentities(parsePasswd(passwd), parseGroup(group), contract);

  const tcp4 = await readBoundedText(hostPath(fsRoot, contract.evidence.tcp4), "IPv4 listener evidence");
  const tcp6 = await readBoundedText(hostPath(fsRoot, contract.evidence.tcp6), "IPv6 listener evidence");
  if (parseProcNetTcp(tcp4, contract.port.port) || parseProcNetTcp(tcp6, contract.port.port)) {
    throw new Error("production dashboard port is already listening");
  }

  const pathStatus = {
    productionRoot: await assertOptionalDirectory(fsRoot, contract.paths.productionRoot, "production root"),
    configDir: await assertOptionalDirectory(fsRoot, contract.paths.configDir, "production config directory"),
    agentRuntimeDirectory: await assertOptionalDirectory(fsRoot, contract.paths.agentRuntimeDirectory, "agent runtime directory"),
    terminalStateDirectory: await assertOptionalDirectory(fsRoot, contract.paths.terminalStateDirectory, "terminal state directory"),
  };
  await assertAbsentPath(fsRoot, contract.paths.agentSocket, "agent socket");
  await assertAbsentPath(fsRoot, contract.paths.terminalSocket, "terminal socket");

  const units = await inspectUnits(fsRoot, sourceRoot, contract);

  return {
    status: "READY",
    schema: HOST_READINESS_SCHEMA,
    mode: contract.mode,
    runtime: { platform: runtime.platform, arch: runtime.arch, nodeMajor: contract.runtime.nodeMajor },
    port: { host: contract.port.host, port: contract.port.port, state: "free" },
    identities: identity,
    paths: pathStatus,
    units,
    baseCapabilities: { quickCommands: "disabled", terminal: "disabled" },
    deploymentAuthorized: false,
  };
}

function repositoryRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

async function main() {
  try {
    if (process.argv.length !== 2) throw new Error("production host readiness verifier accepts no CLI arguments");
    const root = repositoryRoot();
    const contract = JSON.parse(await readFile(resolve(root, "ops/production/host-readiness-contract.json"), "utf8"));
    const launch = JSON.parse(await readFile(resolve(root, "ops/production/launch-contract.json"), "utf8"));
    const result = await verifyHostReadiness({
      fsRoot: "/",
      sourceRoot: root,
      runtime: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.versions.node,
        execPath: process.execPath,
      },
      contract,
      launch,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "production host readiness failed";
    process.stderr.write(`${JSON.stringify({ status: "BLOCKED", error: message, deploymentAuthorized: false })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
