import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import process from "node:process";

import {
  AGENT_UNIT_PATH,
  TERMINAL_SERVICE_PATH,
  TERMINAL_SOCKET_PATH,
  WEB_ENV_EXAMPLE_PATH,
  WEB_UNIT_PATH,
  validateBlueprintTexts,
  validateProductionContract,
  validateReleasePath,
  validateRepositoryBlueprints,
  validateRuntime,
} from "./production-launch-preflight.mjs";

const repoRoot = process.cwd();

async function readBlueprints() {
  const [webUnit, agentUnit, terminalSocket, terminalService, webEnv] = await Promise.all([
    readFile(WEB_UNIT_PATH, "utf8"),
    readFile(AGENT_UNIT_PATH, "utf8"),
    readFile(TERMINAL_SOCKET_PATH, "utf8"),
    readFile(TERMINAL_SERVICE_PATH, "utf8"),
    readFile(WEB_ENV_EXAMPLE_PATH, "utf8"),
  ]);
  return { webUnit, agentUnit, terminalSocket, terminalService, webEnv };
}

test("canonical production launch blueprints pass the read-only preflight", async () => {
  assert.deepEqual(await validateRepositoryBlueprints(repoRoot), []);
});

test("runtime gate accepts only Linux Node 24 on x64 or arm64", () => {
  assert.deepEqual(validateRuntime({ platform: "linux", arch: "x64", nodeVersion: "24.19.0" }), []);
  assert.deepEqual(validateRuntime({ platform: "linux", arch: "arm64", nodeVersion: "24.19.0" }), []);
  assert.ok(validateRuntime({ platform: "darwin", arch: "arm64", nodeVersion: "24.19.0" }).length > 0);
  assert.ok(validateRuntime({ platform: "linux", arch: "ppc64", nodeVersion: "24.19.0" }).length > 0);
  assert.ok(validateRuntime({ platform: "linux", arch: "x64", nodeVersion: "25.0.0" }).length > 0);
});

test("release path is exact-sha and canonical", () => {
  const sha = "a".repeat(40);
  assert.deepEqual(validateReleasePath(`/opt/dashboard_RPi5/releases/${sha}`, sha), []);
  assert.ok(validateReleasePath("/opt/dashboard_RPi5/current", sha).length > 0);
  assert.ok(validateReleasePath(`/opt/dashboard_RPi5/releases/${sha}`, "ABC").length > 0);
});

test("base web service cannot inherit terminal connector membership", async () => {
  const texts = await readBlueprints();
  const modified = {
    ...texts,
    webUnit: `${texts.webUnit}\nSupplementaryGroups=dashboard-rpi5-terminal-client\n`,
  };
  assert.ok(validateBlueprintTexts(modified).some((error) => error.includes("base web unit")));
});

test("read agent cannot inherit terminal connector membership", async () => {
  const texts = await readBlueprints();
  const modified = {
    ...texts,
    agentUnit: `${texts.agentUnit}\nSupplementaryGroups=dashboard-rpi5-terminal-client\n`,
  };
  assert.ok(validateBlueprintTexts(modified).some((error) => error.includes("agent unit")));
});

test("terminal listener must stay one fixed Unix socket", async () => {
  const texts = await readBlueprints();
  const modified = {
    ...texts,
    terminalSocket: texts.terminalSocket.replace(
      "ListenStream=/run/dashboard-rpi5-terminal.sock",
      "ListenStream=0.0.0.0:9999",
    ),
  };
  assert.ok(validateBlueprintTexts(modified).some((error) => error.includes("fixed Unix ListenStream")));
});

test("terminal worker must retain no supplementary groups and no cgroup delegation", async () => {
  const texts = await readBlueprints();
  const withGroup = {
    ...texts,
    terminalService: texts.terminalService.replace("SupplementaryGroups=", "SupplementaryGroups=docker"),
  };
  assert.ok(validateBlueprintTexts(withGroup).some((error) => error.includes("clear supplementary groups")));

  const withDelegate = {
    ...texts,
    terminalService: `${texts.terminalService}\nDelegate=yes\n`,
  };
  assert.ok(validateBlueprintTexts(withDelegate).some((error) => error.includes("Delegate=")));
});

test("base environment must keep full terminal disabled", async () => {
  const texts = await readBlueprints();
  const modified = {
    ...texts,
    webEnv: texts.webEnv.replace("DASHBOARD_TERMINAL_ENABLED=disabled", "DASHBOARD_TERMINAL_ENABLED=enabled"),
  };
  assert.ok(validateBlueprintTexts(modified).some((error) => error.includes("base web environment")));
});

test("production identities are distinct and socket roles are fixed", async () => {
  const contract = JSON.parse(await readFile("ops/production/launch-contract.json", "utf8"));
  assert.deepEqual(validateProductionContract(contract), []);
  contract.agent.user = contract.web.user;
  assert.ok(validateProductionContract(contract).some((error) => error.includes("users must be distinct")));
});

test("preflight source contains no host mutation or process execution primitive", async () => {
  const source = await readFile("tools/production-launch-preflight.mjs", "utf8");
  for (const forbidden of [
    "node:child_process",
    "systemctl",
    "useradd",
    "groupadd",
    "usermod",
    "chmod(",
    "chown(",
    "writeFile(",
    "rm(",
    "unlink(",
    "rename(",
  ]) {
    assert.equal(source.includes(forbidden), false, `preflight unexpectedly contains ${forbidden}`);
  }
});
