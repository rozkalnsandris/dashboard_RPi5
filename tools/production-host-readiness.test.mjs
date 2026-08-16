import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseGroup,
  parsePasswd,
  parseProcNetTcp,
  validateHostReadinessContract,
  verifyHostReadiness,
} from "./production-host-readiness.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME = Object.freeze({ platform: "linux", arch: "arm64", nodeVersion: "24.16.0", execPath: "/usr/bin/node" });
const TCP_HEADER = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n";

async function loadJson(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), "utf8"));
}

function hostPath(fsRoot, absolutePath) {
  return resolve(fsRoot, absolutePath.slice(1));
}

async function writeHost(fsRoot, absolutePath, content) {
  const path = hostPath(fsRoot, absolutePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function makeHost(t) {
  const fsRoot = await mkdtemp(resolve(tmpdir(), "dashboard-host-readiness-"));
  t.after(async () => rm(fsRoot, { recursive: true, force: true }));
  await writeHost(fsRoot, "/etc/passwd", "root:x:0:0:root:/root:/bin/bash\n");
  await writeHost(fsRoot, "/etc/group", "root:x:0:\n");
  await writeHost(fsRoot, "/proc/net/tcp", TCP_HEADER);
  await writeHost(fsRoot, "/proc/net/tcp6", TCP_HEADER);
  await writeHost(fsRoot, "/proc/1/comm", "systemd\n");
  await mkdir(hostPath(fsRoot, "/run/systemd/system"), { recursive: true });
  return fsRoot;
}

async function verifyFixture(t, overrides = {}) {
  const fsRoot = overrides.fsRoot ?? await makeHost(t);
  const contract = overrides.contract ?? await loadJson("ops/production/host-readiness-contract.json");
  const launch = overrides.launch ?? await loadJson("ops/production/launch-contract.json");
  return verifyHostReadiness({ fsRoot, sourceRoot: ROOT, runtime: overrides.runtime ?? RUNTIME, contract, launch });
}

test("host readiness contract stays synchronized with production launch contract", async () => {
  const contract = await loadJson("ops/production/host-readiness-contract.json");
  const launch = await loadJson("ops/production/launch-contract.json");
  assert.equal(validateHostReadinessContract(contract, launch), contract);
  assert.throws(() => validateHostReadinessContract({ ...contract, mutationAllowed: true }, launch), /forbidden capability/u);
  assert.throws(() => validateHostReadinessContract({ ...contract, port: { ...contract.port, port: 9999 } }, launch), /port contract mismatch/u);
});

test("clean first-launch fixture is READY without inventing deployment authorization", async (t) => {
  const result = await verifyFixture(t);
  assert.equal(result.status, "READY");
  assert.equal(result.runtime.arch, "arm64");
  assert.equal(result.runtime.nodeMajor, 24);
  assert.equal(result.port.state, "free");
  assert.equal(result.identities.users, "absent-clean");
  assert.equal(result.identities.groups, "absent-clean");
  assert.equal(result.units, "absent-clean");
  assert.equal(result.deploymentAuthorized, false);
});

test("compatible pre-created identities are accepted with least privilege", async (t) => {
  const fsRoot = await makeHost(t);
  await writeHost(fsRoot, "/etc/passwd", [
    "root:x:0:0:root:/root:/bin/bash",
    "dashboard-rpi5-web:x:1101:1201::/nonexistent:/usr/sbin/nologin",
    "dashboard-rpi5-agent:x:1102:1202::/nonexistent:/usr/sbin/nologin",
    "dashboard-rpi5-terminal:x:1103:1203::/var/lib/dashboard-rpi5-terminal:/usr/sbin/nologin",
    "",
  ].join("\n"));
  await writeHost(fsRoot, "/etc/group", [
    "root:x:0:",
    "dashboard-rpi5-web:x:1201:",
    "dashboard-rpi5-agent-client:x:1202:dashboard-rpi5-web",
    "dashboard-rpi5-terminal:x:1203:",
    "dashboard-rpi5-terminal-client:x:1204:",
    "",
  ].join("\n"));
  const result = await verifyFixture(t, { fsRoot });
  assert.equal(result.identities.users, "present-compatible");
  assert.equal(result.identities.presentUserCount, 3);
  assert.equal(result.identities.presentGroupCount, 4);
});

test("terminal capability leakage into web identity is BLOCKED", async (t) => {
  const fsRoot = await makeHost(t);
  await writeHost(fsRoot, "/etc/passwd", [
    "root:x:0:0:root:/root:/bin/bash",
    "dashboard-rpi5-web:x:1101:1201::/nonexistent:/usr/sbin/nologin",
    "",
  ].join("\n"));
  await writeHost(fsRoot, "/etc/group", [
    "root:x:0:",
    "dashboard-rpi5-web:x:1201:",
    "dashboard-rpi5-agent-client:x:1202:dashboard-rpi5-web",
    "dashboard-rpi5-terminal-client:x:1204:dashboard-rpi5-web",
    "",
  ].join("\n"));
  await assert.rejects(verifyFixture(t, { fsRoot }), /unreviewed supplementary|forbidden capability/u);
});

test("root identity collisions and malformed account databases fail closed", async (t) => {
  const rootCollision = await makeHost(t);
  await writeHost(rootCollision, "/etc/passwd", [
    "root:x:0:0:root:/root:/bin/bash",
    "dashboard-rpi5-web:x:0:1201::/nonexistent:/usr/sbin/nologin",
    "",
  ].join("\n"));
  await writeHost(rootCollision, "/etc/group", "root:x:0:\ndashboard-rpi5-web:x:1201:\n");
  await assert.rejects(verifyFixture(t, { fsRoot: rootCollision }), /root identity/u);

  assert.throws(() => parsePasswd("broken:x:not-a-uid:1:x:/x:/bin/false\n"), /unsigned integer/u);
  assert.throws(() => parseGroup("broken:x:not-a-gid:\n"), /unsigned integer/u);
});

test("production runtime must be Linux arm64 Node 24 at the reviewed executable path", async (t) => {
  await assert.rejects(verifyFixture(t, { runtime: { ...RUNTIME, arch: "x64" } }), /architecture mismatch/u);
  await assert.rejects(verifyFixture(t, { runtime: { ...RUNTIME, nodeVersion: "26.0.0" } }), /Node major mismatch/u);
  await assert.rejects(verifyFixture(t, { runtime: { ...RUNTIME, execPath: "/usr/local/bin/node" } }), /executable path mismatch/u);
});

test("any listener on fixed port 8787 blocks bootstrap", async (t) => {
  const fsRoot = await makeHost(t);
  const row = "   0: 0100007F:2253 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 0 1\n";
  await writeHost(fsRoot, "/proc/net/tcp", `${TCP_HEADER}${row}`);
  assert.equal(parseProcNetTcp(`${TCP_HEADER}${row}`, 8787), true);
  await assert.rejects(verifyFixture(t, { fsRoot }), /port is already listening/u);
});

test("socket and directory symlink traps block", async (t) => {
  const socketHost = await makeHost(t);
  await writeHost(socketHost, "/run/dashboard-rpi5/agent.sock", "not-a-socket\n");
  await assert.rejects(verifyFixture(t, { fsRoot: socketHost }), /agent socket must be absent/u);

  const symlinkHost = await makeHost(t);
  await mkdir(hostPath(symlinkHost, "/tmp/config-target"), { recursive: true });
  await mkdir(dirname(hostPath(symlinkHost, "/etc/dashboard-rpi5")), { recursive: true });
  await symlink(hostPath(symlinkHost, "/tmp/config-target"), hostPath(symlinkHost, "/etc/dashboard-rpi5"));
  await assert.rejects(verifyFixture(t, { fsRoot: symlinkHost }), /config directory exists with an unsafe filesystem type/u);
});

test("matching installed units remain compatible but drift or enablement blocks", async (t) => {
  const contract = await loadJson("ops/production/host-readiness-contract.json");
  const matchingHost = await makeHost(t);
  const webUnit = contract.units.find((unit) => unit.name === "dashboard-rpi5-web.service");
  assert.ok(webUnit);
  const installed = hostPath(matchingHost, webUnit.installed);
  await mkdir(dirname(installed), { recursive: true });
  await copyFile(resolve(ROOT, webUnit.source), installed);
  const matching = await verifyFixture(t, { fsRoot: matchingHost, contract });
  assert.equal(matching.units, "matching-disabled");

  const driftHost = await makeHost(t);
  await writeHost(driftHost, webUnit.installed, "[Unit]\nDescription=unexpected drift\n");
  await assert.rejects(verifyFixture(t, { fsRoot: driftHost, contract }), /differs from reviewed source blueprint/u);

  const enabledHost = await makeHost(t);
  const enabledPath = hostPath(enabledHost, webUnit.enablementLinks[0]);
  await mkdir(dirname(enabledPath), { recursive: true });
  await symlink("../dashboard-rpi5-web.service", enabledPath);
  await assert.rejects(verifyFixture(t, { fsRoot: enabledHost, contract }), /already enabled/u);
});

test("missing required evidence fails closed", async (t) => {
  const fsRoot = await makeHost(t);
  await rm(hostPath(fsRoot, "/proc/net/tcp6"));
  await assert.rejects(verifyFixture(t, { fsRoot }), /ENOENT/u);
});

test("verifier source has no process, network or filesystem mutation primitives", async () => {
  const source = await readFile(resolve(ROOT, "tools/production-host-readiness.mjs"), "utf8");
  assert.doesNotMatch(source, /node:child_process|node:(?:net|http|https|dgram)|\bfetch\s*\(|\bexec(?:File)?\s*\(|\bspawn\s*\(/iu);
  assert.doesNotMatch(source, /\b(?:writeFile|appendFile|mkdir|rename|unlink|rm|rmdir|chmod|chown|symlink|copyFile)\s*\(/u);
  assert.doesNotMatch(source, /systemctl|\bservice\b|useradd|groupadd|usermod|\bsudo\b|docker\.sock|cloudflare\.com\/client\/v4/iu);
  assert.doesNotMatch(source, /["']--root["']/u);
});
