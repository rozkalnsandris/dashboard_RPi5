import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseActivationBindings, validateCloudflareContract } from "./production-cloudflare-preflight.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VALID_BINDINGS = [
  "DASHBOARD_CLOUDFLARE_TEAM_NAME=rozkalns",
  "DASHBOARD_CLOUDFLARE_APPLICATION_AUDIENCE=32eafc7626e974616deaf0dc3ce63d7bcbed58a2731e84d06bc3cdf1b53c4228",
  "DASHBOARD_OWNER_EMAIL=owner@example.com",
  "DASHBOARD_CLOUDFLARE_TUNNEL_ID=12345678-1234-4abc-8def-1234567890ab",
].join("\n");

async function loadJson(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), "utf8"));
}

test("source Cloudflare launch contract matches production loopback and cloudflared JWT boundary", async () => {
  const contract = await loadJson("ops/production/cloudflare-contract.json");
  const launch = await loadJson("ops/production/launch-contract.json");
  assert.deepEqual(validateCloudflareContract(contract, launch), {
    schema: "dashboard-rpi5.cloudflare-launch.v2",
    hostname: "dash.rozkalns.net",
    origin: "http://127.0.0.1:8787",
    baseJwtEnforcementPoint: "cloudflared_protect_with_access",
  });
});

test("Cloudflare contract rejects route drift and weaker Access policy modes", async () => {
  const contract = await loadJson("ops/production/cloudflare-contract.json");
  const launch = await loadJson("ops/production/launch-contract.json");

  assert.throws(() => validateCloudflareContract({ ...contract, origin: { ...contract.origin, port: 8788 } }, launch), /origin mismatch/u);
  assert.throws(() => validateCloudflareContract({ ...contract, access: { ...contract.access, bypassAllowed: true } }, launch), /forbidden policy mode/u);
  assert.throws(() => validateCloudflareContract({ ...contract, access: { ...contract.access, emailDomainWildcardAllowed: true } }, launch), /forbidden policy mode/u);
  assert.throws(() => validateCloudflareContract({ ...contract, access: { ...contract.access, allowValueBinding: "DASHBOARD_OWNER_DOMAIN" } }, launch), /owner policy invariant/u);
});

test("Cloudflare contract requires exact cloudflared Protect with Access JWT semantics", async () => {
  const contract = await loadJson("ops/production/cloudflare-contract.json");
  const launch = await loadJson("ops/production/launch-contract.json");

  assert.throws(() => validateCloudflareContract({ ...contract, tunnel: { ...contract.tunnel, protectWithAccess: { ...contract.tunnel.protectWithAccess, required: false } } }, launch), /Protect with Access/u);
  assert.throws(() => validateCloudflareContract({ ...contract, tunnel: { ...contract.tunnel, protectWithAccess: { ...contract.tunnel.protectWithAccess, teamNameBinding: "WRONG_TEAM" } } }, launch), /Protect with Access/u);
  assert.throws(() => validateCloudflareContract({ ...contract, tunnel: { ...contract.tunnel, protectWithAccess: { ...contract.tunnel.protectWithAccess, audienceBinding: "WRONG_AUD" } } }, launch), /Protect with Access/u);
  assert.throws(() => validateCloudflareContract({ ...contract, access: { ...contract.access, baseApplicationJwtBoundary: { ...contract.access.baseApplicationJwtBoundary, enforcementPoint: "fastify_global_middleware" } } }, launch), /base application JWT boundary/u);
  assert.throws(() => validateCloudflareContract({ ...contract, access: { ...contract.access, baseApplicationJwtBoundary: { ...contract.access.baseApplicationJwtBoundary, fastifyGlobalMiddlewareRequired: true } } }, launch), /base application JWT boundary/u);
});


test("Phase 11C documents cloudflared as the base JWT gate and keeps terminal verification separate", async () => {
  const doc = await readFile(resolve(ROOT, "docs/PHASE11C_CLOUDFLARE_LAUNCH.md"), "utf8");
  assert.match(doc, /cloudflared` Protect with Access before origin proxy/iu);
  assert.match(doc, /not required to register a global Access-JWT middleware/iu);
  assert.match(doc, /cloudflare-access-owner-auth\.ts.*independent application-layer cryptographic verifier/isu);
});

test("activation bindings accept only exact reviewed value classes", () => {
  assert.deepEqual(parseActivationBindings(VALID_BINDINGS), { bindingsValid: true, bindingCount: 4 });
  assert.throws(() => parseActivationBindings(VALID_BINDINGS.replace("owner@example.com", "REQUIRED_OWNER_EMAIL")), /binding value is invalid/u);
  assert.throws(() => parseActivationBindings(VALID_BINDINGS.replace("owner@example.com", "@example.com")), /owner email binding is invalid/u);
  assert.throws(() => parseActivationBindings(`${VALID_BINDINGS}\nCF_API_TOKEN=secret`), /key is not allowed/u);
});

test("activation bindings reject duplicate and missing values", () => {
  assert.throws(() => parseActivationBindings(`${VALID_BINDINGS}\nDASHBOARD_OWNER_EMAIL=other@example.com`), /duplicated/u);
  assert.throws(() => parseActivationBindings(VALID_BINDINGS.split("\n").slice(0, 3).join("\n")), /required activation binding is missing/u);
});

test("Cloudflare preflight source remains read-only and network-free", async () => {
  const source = await readFile(resolve(ROOT, "tools/production-cloudflare-preflight.mjs"), "utf8");
  assert.doesNotMatch(source, /node:child_process|\bfetch\s*\(|writeFile|appendFile|systemctl|cloudflare\.com\/client\/v4/iu);
});
