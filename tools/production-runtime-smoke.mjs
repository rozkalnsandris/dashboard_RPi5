import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const START_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 1_500;
const STOP_TIMEOUT_MS = 2_000;
const OUTPUT_LIMIT = 16 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const FULL_SHA = /^[0-9a-f]{40}$/u;

function parseCli(argv) {
  const args = [...argv];
  let rootDir;
  let manifestPath;
  let sourceSha;
  while (args.length > 0) {
    const key = args.shift();
    const value = args.shift();
    if (value === undefined) throw new Error("missing CLI value");
    if (key === "--root") rootDir = value;
    else if (key === "--manifest") manifestPath = value;
    else if (key === "--sha") sourceSha = value;
    else throw new Error("unknown CLI argument");
  }
  if (rootDir === undefined || manifestPath === undefined || sourceSha === undefined) {
    throw new Error(
      "usage: node tools/production-runtime-smoke.mjs --root <repo> --manifest <manifest.json> --sha <40-hex-sha>",
    );
  }
  if (!FULL_SHA.test(sourceSha)) throw new Error("source SHA is invalid");
  return { rootDir, manifestPath, sourceSha };
}

function safeRelativePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    isAbsolute(value)
  ) {
    throw new Error("candidate manifest path is invalid");
  }
  const parts = value.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new Error("candidate manifest path is invalid");
  }
  if (parts.includes("node_modules")) {
    throw new Error("candidate manifest must not contain node_modules");
  }
  return value;
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function materializeCandidate({ rootDir, candidateRoot, manifest }) {
  if (!Array.isArray(manifest.files) || manifest.files.length !== manifest.fileCount) {
    throw new Error("candidate manifest file count mismatch");
  }

  for (const file of manifest.files) {
    const relativePath = safeRelativePath(file?.path);
    if (!Number.isSafeInteger(file?.bytes) || file.bytes < 0 || !SHA256.test(file?.sha256 ?? "")) {
      throw new Error(`candidate manifest metadata is invalid: ${relativePath}`);
    }

    const sourcePath = resolve(rootDir, relativePath);
    const sourceStat = await lstat(sourcePath);
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
      throw new Error(`candidate source is not a regular file: ${relativePath}`);
    }
    if (sourceStat.size !== file.bytes || (await sha256File(sourcePath)) !== file.sha256) {
      throw new Error(`candidate source digest mismatch: ${relativePath}`);
    }

    const destinationPath = resolve(candidateRoot, relativePath);
    if (!destinationPath.startsWith(`${candidateRoot}${sep}`)) {
      throw new Error(`candidate destination escaped root: ${relativePath}`);
    }
    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL);
    if ((await sha256File(destinationPath)) !== file.sha256) {
      throw new Error(`materialized candidate digest mismatch: ${relativePath}`);
    }
  }
}

async function assertNoNodeModulesResolutionPath(candidateRoot) {
  let current = candidateRoot;
  while (true) {
    if (await pathExists(resolve(current, "node_modules"))) {
      throw new Error(`node_modules exists on candidate resolution path: ${current}`);
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function createProductionCurrentLink(tempRoot, sourceSha) {
  if (!FULL_SHA.test(sourceSha)) throw new Error("source SHA is invalid");
  const currentRoot = resolve(tempRoot, "current");
  await symlink(`releases/${sourceSha}`, currentRoot, "dir");
  return currentRoot;
}

function appendBounded(current, chunk) {
  const next = current + chunk;
  return next.length <= OUTPUT_LIMIT ? next : next.slice(next.length - OUTPUT_LIMIT);
}

function spawnRuntime(entryPath, cwd, env) {
  const child = spawn(process.execPath, [entryPath], {
    cwd,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? tmpdir(),
      LANG: process.env.LANG ?? "C.UTF-8",
      NODE_ENV: "production",
      NODE_OPTIONS: "",
      NODE_PATH: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const captured = { stdout: "", stderr: "" };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    captured.stdout = appendBounded(captured.stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    captured.stderr = appendBounded(captured.stderr, chunk);
  });
  return { child, captured };
}

function runtimeFailure(label, runtime, cause) {
  const detail = cause instanceof Error ? cause.message : String(cause ?? "runtime failed");
  return new Error(
    `${label}: ${detail}\nstdout:\n${runtime.captured.stdout}\nstderr:\n${runtime.captured.stderr}`,
  );
}

async function stopRuntime(runtime) {
  if (runtime === undefined || runtime.child.exitCode !== null) return;
  runtime.child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolvePromise) => runtime.child.once("exit", () => resolvePromise(true))),
    delay(STOP_TIMEOUT_MS).then(() => false),
  ]);
  if (exited) return;
  runtime.child.kill("SIGKILL");
  await new Promise((resolvePromise) => runtime.child.once("exit", resolvePromise));
}

function request({ host, port, socketPath, path }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = httpRequest(
      {
        method: "GET",
        ...(socketPath === undefined ? { host, port } : { socketPath }),
        path,
      },
      (res) => {
        res.setEncoding("utf8");
        let body = "";
        res.on("data", (chunk) => {
          body = appendBounded(body, chunk);
        });
        res.on("end", () => {
          resolvePromise({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body,
          });
        });
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("request timeout")));
    req.on("error", rejectPromise);
    req.end();
  });
}

async function waitFor(runtime, label, probe) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    if (runtime.child.exitCode !== null) {
      throw runtimeFailure(label, runtime, `process exited ${runtime.child.exitCode}`);
    }
    try {
      return await probe();
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw runtimeFailure(label, runtime, lastError ?? new Error("startup timeout"));
}

async function reserveLoopbackPort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => rejectPromise(new Error("failed to reserve loopback port")));
        return;
      }
      const { port } = address;
      server.close((error) => (error === undefined ? resolvePromise(port) : rejectPromise(error)));
    });
  });
}

async function assertExactLoopbackListener(port) {
  const { stdout } = await execFileAsync("ss", ["-H", "-ltn"]);
  const listeners = stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/u)[3])
    .filter((value) => value?.endsWith(`:${port}`));
  if (listeners.length !== 1 || listeners[0] !== `127.0.0.1:${port}`) {
    throw new Error(`unexpected TCP listener for ${port}: ${listeners.join(",") || "none"}`);
  }
}

async function runSmoke({ rootDir, manifestPath, sourceSha }) {
  const root = resolve(rootDir);
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
  if (manifest.sourceSha !== sourceSha || manifest.nodeMajor !== 24) {
    throw new Error("candidate manifest source/runtime mismatch");
  }

  const tempRoot = await mkdtemp(resolve(tmpdir(), "dashboard-rpi5-runtime-smoke-"));
  const candidateRoot = resolve(tempRoot, "releases", sourceSha);
  const runtimeRoot = resolve(tempRoot, "runtime");
  await mkdir(candidateRoot, { recursive: true });
  await mkdir(runtimeRoot, { recursive: true });

  let agentRuntime;
  let webRuntime;
  try {
    await materializeCandidate({ rootDir: root, candidateRoot, manifest });
    await assertNoNodeModulesResolutionPath(candidateRoot);
    const currentRoot = await createProductionCurrentLink(tempRoot, sourceSha);

    const agentSocket = resolve(runtimeRoot, "agent.sock");
    agentRuntime = spawnRuntime(
      resolve(currentRoot, "apps/agent/dist/index.js"),
      currentRoot,
      {
        DASHBOARD_RPI5_AGENT_SOCKET: agentSocket,
        DASHBOARD_RPI5_QUICK_COMMANDS: "disabled",
      },
    );

    const agentHealth = await waitFor(agentRuntime, "agent runtime smoke failed", async () => {
      const response = await request({ socketPath: agentSocket, path: "/v1/health" });
      const body = JSON.parse(response.body);
      if (response.statusCode !== 200 || body.status !== "ok" || body.service !== "dashboard-rpi5-agent") {
        throw new Error(`unexpected agent health: ${response.statusCode} ${response.body}`);
      }
      return response;
    });

    const quickCommands = await request({ socketPath: agentSocket, path: "/v1/quick-commands" });
    if (quickCommands.statusCode >= 200 && quickCommands.statusCode < 300) {
      throw runtimeFailure(
        "agent runtime smoke failed",
        agentRuntime,
        `Quick Commands unexpectedly enabled: ${quickCommands.statusCode}`,
      );
    }

    const port = await reserveLoopbackPort();
    webRuntime = spawnRuntime(
      resolve(currentRoot, "apps/server/dist/index.js"),
      currentRoot,
      {
        PORT: String(port),
        DASHBOARD_WEB_ROOT: resolve(currentRoot, "apps/web/dist"),
        DASHBOARD_AGENT_SOCKET_PATH: agentSocket,
        DASHBOARD_TERMINAL_ENABLED: "disabled",
      },
    );

    const webHealth = await waitFor(webRuntime, "web runtime smoke failed", async () => {
      const response = await request({ host: "127.0.0.1", port, path: "/api/health" });
      const body = JSON.parse(response.body);
      if (response.statusCode !== 200 || body.status !== "ok" || body.service !== "dashboard-rpi5-server") {
        throw new Error(`unexpected web health: ${response.statusCode} ${response.body}`);
      }
      return response;
    });

    await assertExactLoopbackListener(port);

    const spa = await request({ host: "127.0.0.1", port, path: "/" });
    if (spa.statusCode !== 200 || !String(spa.headers["content-type"] ?? "").includes("text/html")) {
      throw runtimeFailure(
        "web runtime smoke failed",
        webRuntime,
        `SPA root failed: ${spa.statusCode} ${spa.headers["content-type"] ?? ""}`,
      );
    }

    return {
      status: "PASS",
      sourceSha,
      candidateSha256: manifest.candidateSha256,
      nodeModulesResolutionPath: "absent",
      agent: {
        healthStatus: agentHealth.statusCode,
        quickCommandsStatus: quickCommands.statusCode,
      },
      web: {
        healthStatus: webHealth.statusCode,
        listener: `127.0.0.1:${port}`,
        spaStatus: spa.statusCode,
      },
      terminal: "disabled",
    };
  } finally {
    await stopRuntime(webRuntime);
    await stopRuntime(agentRuntime);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  try {
    const result = await runSmoke(parseCli(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "runtime smoke failed";
    process.stderr.write(`${JSON.stringify({ status: "BLOCKED", error: message })}\n`);
    process.exitCode = 1;
  }
}

export {
  assertNoNodeModulesResolutionPath,
  createProductionCurrentLink,
  materializeCandidate,
  runSmoke,
  safeRelativePath,
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
