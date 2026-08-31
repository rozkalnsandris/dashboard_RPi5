import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runNode(entrypoint) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [entrypoint], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
  });
}

test("production controller CLI executes through a current-style symlink", async (t) => {
  const workspace = await mkdtemp(resolve(tmpdir(), "dashboard-release-cli-symlink-"));
  t.after(async () => rm(workspace, { recursive: true, force: true }));

  const entrypoint = resolve(workspace, "production-release-controller.mjs");
  await symlink(resolve(ROOT, "tools/production-release-controller.mjs"), entrypoint);

  const result = await runNode(entrypoint);

  assert.equal(result.signal, null);
  assert.equal(result.stdout, "");
  assert.equal(result.code, 1, `controller must fail closed instead of silently exiting: ${result.stderr}`);
  assert.deepEqual(JSON.parse(result.stderr.trim()), {
    status: "BLOCKED",
    error: "activation requires --candidate-root, --manifest and --sha",
  });
});
