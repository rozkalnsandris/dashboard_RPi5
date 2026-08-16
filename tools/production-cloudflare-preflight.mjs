import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const CLOUDFLARE_CONTRACT_SCHEMA = "dashboard-rpi5.cloudflare-launch.v2";

const HOSTNAME = "dash.rozkalns.net";
const ORIGIN = "http://127.0.0.1:8787";
const OWNER_EMAIL_BINDING = "DASHBOARD_OWNER_EMAIL";
const TEAM_NAME_BINDING = "DASHBOARD_CLOUDFLARE_TEAM_NAME";
const AUDIENCE_BINDING = "DASHBOARD_CLOUDFLARE_APPLICATION_AUDIENCE";
const TUNNEL_ID_BINDING = "DASHBOARD_CLOUDFLARE_TUNNEL_ID";
const ACCESS_HEADER = "Cf-Access-Jwt-Assertion";
const BASE_JWT_ENFORCEMENT_POINT = "cloudflared_protect_with_access";
const TUNNEL_JWT_VALIDATION_POINT = "before_origin_proxy";
const MAX_FILE_BYTES = 64 * 1024;
const TEAM_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const AUDIENCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const TUNNEL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const PLACEHOLDER_PATTERN = /^(?:REQUIRED|CHANGEME|EXAMPLE|PLACEHOLDER)(?:_|$)/iu;

const REQUIRED_BINDINGS = Object.freeze([
  TEAM_NAME_BINDING,
  AUDIENCE_BINDING,
  OWNER_EMAIL_BINDING,
  TUNNEL_ID_BINDING,
]);

const ACTIVATION_ORDER = Object.freeze([
  "create_access_application",
  "create_exact_owner_allow_policy",
  "verify_access_deny_by_default",
  "publish_tunnel_route",
  "verify_tunnel_access_jwt_gate",
  "verify_unauthenticated_block",
  "authenticated_smoke",
]);

function assertObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertExactArray(value, expected, label) {
  if (!Array.isArray(value) || value.length !== expected.length) {
    throw new Error(`${label} mismatch`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (value[index] !== expected[index]) throw new Error(`${label} mismatch`);
  }
}

function hasAsciiControl(value) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function validateCloudflareContract(contractValue, launchValue) {
  const contract = assertObject(contractValue, "Cloudflare contract");
  const launch = assertObject(launchValue, "production launch contract");
  if (contract.schema !== CLOUDFLARE_CONTRACT_SCHEMA) throw new Error("Cloudflare contract schema mismatch");
  if (contract.sourceOnly !== true) throw new Error("Cloudflare contract must remain source-only");
  if (contract.hostname !== HOSTNAME) throw new Error("Cloudflare hostname mismatch");

  const launchWeb = assertObject(launch.web, "production launch web contract");
  if (launchWeb.host !== "127.0.0.1" || launchWeb.port !== 8787) {
    throw new Error("production launch web origin mismatch");
  }

  const origin = assertObject(contract.origin, "Cloudflare origin contract");
  if (origin.url !== ORIGIN || origin.scheme !== "http" || origin.host !== launchWeb.host || origin.port !== launchWeb.port) {
    throw new Error("Cloudflare origin mismatch");
  }

  const access = assertObject(contract.access, "Cloudflare Access contract");
  if (access.applicationType !== "self_hosted" || access.entireHostname !== true || access.denyByDefault !== true) {
    throw new Error("Cloudflare Access application invariant mismatch");
  }
  if (access.allowPolicyAction !== "allow" || access.allowSelector !== "email" || access.allowValueBinding !== OWNER_EMAIL_BINDING || access.exactlyOneOwner !== true) {
    throw new Error("Cloudflare Access owner policy invariant mismatch");
  }
  if (access.emailDomainWildcardAllowed !== false || access.bypassAllowed !== false || access.serviceTokenOnlyHumanAccessAllowed !== false) {
    throw new Error("Cloudflare Access forbidden policy mode enabled");
  }

  const baseBoundary = assertObject(access.baseApplicationJwtBoundary, "base application JWT boundary");
  if (
    baseBoundary.enforcementPoint !== BASE_JWT_ENFORCEMENT_POINT ||
    baseBoundary.assertionHeader !== ACCESS_HEADER ||
    baseBoundary.teamNameBinding !== TEAM_NAME_BINDING ||
    baseBoundary.audienceBinding !== AUDIENCE_BINDING ||
    baseBoundary.fastifyGlobalMiddlewareRequired !== false
  ) {
    throw new Error("base application JWT boundary mismatch");
  }

  const tunnel = assertObject(contract.tunnel, "Cloudflare Tunnel contract");
  if (tunnel.routeType !== "published_application" || tunnel.hostname !== HOSTNAME || tunnel.service !== ORIGIN || tunnel.tunnelIdBinding !== TUNNEL_ID_BINDING) {
    throw new Error("Cloudflare Tunnel route invariant mismatch");
  }
  const protectWithAccess = assertObject(tunnel.protectWithAccess, "Tunnel Protect with Access contract");
  if (
    protectWithAccess.required !== true ||
    protectWithAccess.validationPoint !== TUNNEL_JWT_VALIDATION_POINT ||
    protectWithAccess.assertionHeader !== ACCESS_HEADER ||
    protectWithAccess.teamNameBinding !== TEAM_NAME_BINDING ||
    protectWithAccess.audienceBinding !== AUDIENCE_BINDING
  ) {
    throw new Error("Tunnel Protect with Access invariant mismatch");
  }

  if (
    baseBoundary.teamNameBinding !== protectWithAccess.teamNameBinding ||
    baseBoundary.audienceBinding !== protectWithAccess.audienceBinding ||
    baseBoundary.assertionHeader !== protectWithAccess.assertionHeader
  ) {
    throw new Error("base JWT boundary and Tunnel Protect with Access bindings diverged");
  }

  const network = assertObject(contract.network, "Cloudflare network contract");
  if (network.routerPortForward !== false) throw new Error("router port-forward must remain disabled");
  assertExactArray(contract.activationOrder, ACTIVATION_ORDER, "Cloudflare activation order");

  return {
    schema: contract.schema,
    hostname: HOSTNAME,
    origin: ORIGIN,
    baseJwtEnforcementPoint: BASE_JWT_ENFORCEMENT_POINT,
  };
}

export function parseActivationBindings(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) {
    throw new Error("activation binding file is invalid or too large");
  }
  const values = new Map();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (trimmed !== line || trimmed.startsWith("export ")) throw new Error("activation binding line format is invalid");
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("activation binding line format is invalid");
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!REQUIRED_BINDINGS.includes(key)) throw new Error("activation binding key is not allowed");
    if (values.has(key)) throw new Error("activation binding key is duplicated");
    if (value === "" || value.length > 512 || /\s/u.test(value) || hasAsciiControl(value) || PLACEHOLDER_PATTERN.test(value)) {
      throw new Error("activation binding value is invalid");
    }
    values.set(key, value);
  }
  if (values.size !== REQUIRED_BINDINGS.length || REQUIRED_BINDINGS.some((key) => !values.has(key))) {
    throw new Error("required activation binding is missing");
  }

  if (!TEAM_NAME_PATTERN.test(values.get(TEAM_NAME_BINDING))) throw new Error("Cloudflare team name binding is invalid");
  if (!AUDIENCE_PATTERN.test(values.get(AUDIENCE_BINDING))) throw new Error("Cloudflare application audience binding is invalid");
  if (!EMAIL_PATTERN.test(values.get(OWNER_EMAIL_BINDING))) throw new Error("owner email binding is invalid");
  if (!TUNNEL_ID_PATTERN.test(values.get(TUNNEL_ID_BINDING))) throw new Error("Cloudflare tunnel ID binding is invalid");

  return { bindingsValid: true, bindingCount: REQUIRED_BINDINGS.length };
}

async function readBoundedJson(path, label) {
  const raw = await readFile(resolve(path), "utf8");
  if (Buffer.byteLength(raw, "utf8") > MAX_FILE_BYTES) throw new Error(`${label} is too large`);
  return JSON.parse(raw);
}

function parseCli(argv) {
  const args = [...argv];
  let contractPath;
  let launchPath;
  let envPath;
  while (args.length > 0) {
    const key = args.shift();
    const value = args.shift();
    if (value === undefined) throw new Error("missing CLI value");
    if (key === "--contract") contractPath = value;
    else if (key === "--launch") launchPath = value;
    else if (key === "--env") envPath = value;
    else throw new Error("unknown CLI argument");
  }
  if (contractPath === undefined || launchPath === undefined) {
    throw new Error("usage: node tools/production-cloudflare-preflight.mjs --contract <cloudflare-contract.json> --launch <launch-contract.json> [--env <activation.env>]");
  }
  return { contractPath, launchPath, envPath };
}

async function main() {
  try {
    const input = parseCli(process.argv.slice(2));
    const contract = await readBoundedJson(input.contractPath, "Cloudflare contract");
    const launch = await readBoundedJson(input.launchPath, "production launch contract");
    const result = validateCloudflareContract(contract, launch);
    let bindingEvidence = { bindingsValidated: false, bindingCount: 0 };
    if (input.envPath !== undefined) {
      const text = await readFile(resolve(input.envPath), "utf8");
      const parsed = parseActivationBindings(text);
      bindingEvidence = { bindingsValidated: parsed.bindingsValid, bindingCount: parsed.bindingCount };
    }
    process.stdout.write(`${JSON.stringify({ status: "PASS", ...result, ...bindingEvidence })}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cloudflare production preflight failed";
    process.stderr.write(`${JSON.stringify({ status: "BLOCKED", error: message })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
