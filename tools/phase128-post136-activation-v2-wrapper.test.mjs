import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

const wrapperUrl = new URL(
  "./operator/phase128-post136-production-activate-v2.sh",
  import.meta.url,
);
const wrapperPath = fileURLToPath(wrapperUrl);
const source = await readFile(wrapperUrl, "utf8");
const lines = source.split("\n").map((line) => line.trim());

test("v2 activation wrapper has valid bash syntax", () => {
  const result = spawnSync("bash", ["-n", wrapperPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("v2 wrapper binds exact reviewed upstream and candidate manifest", () => {
  for (const required of [
    'UPSTREAM_COMMIT="98675a34d1b9d06f4d3a906232d3789a475997c7"',
    'UPSTREAM_BLOB="929efcd04810af07b2fda5daa4d0c52658a24b24"',
    'EXPECTED_AGGREGATE_SERVER_DIST_SHA="48507348b12cb54693e3c5a790460afb5b400b9a3400f2751b509700c6e33778"',
    'EXPECTED_MANIFEST_SHA="2cc46ad30787355eead24aab90d769cd8cf984fcc8d811ae637939b83abddaf7"',
    'apps/server/dist/index.js',
    "candidate manifest must contain exactly one server launch entry",
    "candidate server launch entry digest is invalid",
  ]) {
    assert.ok(source.includes(required), `missing v2 binding: ${required}`);
  }
});

test("v2 wrapper corrects only the mislabeled aggregate server digest binding", () => {
  for (const required of [
    'old = \'EXPECTED_SERVER_ENTRY_SHA="48507348b12cb54693e3c5a790460afb5b400b9a3400f2751b509700c6e33778"\'',
    "if source.count(old) != 1:",
    'new = f\'EXPECTED_SERVER_ENTRY_SHA="{server_sha}"\'',
    "source.replace(old, new, 1)",
    "server launch entry binding replacement failed",
    "bash -n \"$patched\"",
  ]) {
    assert.ok(source.includes(required), `missing deterministic patch guard: ${required}`);
  }
});

test("v2 wrapper itself has no production mutation surface", () => {
  for (const forbidden of [
    "systemctl restart",
    "systemctl start",
    "systemctl stop",
    "systemctl enable",
    "systemctl disable",
    "systemctl daemon-reload",
    "--apply",
    "--rollback",
    "/usr/sbin/groupadd",
    "/usr/sbin/useradd",
    "usermod ",
    "gpasswd ",
    "chmod ",
    "chown ",
    "cloudflared tunnel",
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `v2 wrapper must not contain production mutation primitive: ${forbidden}`,
    );
  }
});

test("v2 wrapper permits only preflight or the exact owner acknowledgement", () => {
  assert.ok(source.includes('[ "$1" = "--preflight-only" ]'));
  assert.ok(source.includes('[ "$1" = "--owner-ack" ]'));
  assert.ok(
    source.includes(
      'EXPECTED_OWNER_ACK="I_AUTHORIZE_PHASE128_POST136_ACTIVATE_1D9C27A9C2AC2370BC626807E14C5786DE58671B6547DFC2F5C822EFA45E0A2E"',
    ),
  );
  assert.ok(source.includes('upstream_args=(--preflight-only)'));
  assert.ok(source.includes('upstream_args=(--owner-ack "$EXPECTED_OWNER_ACK")'));
});

test("v2 wrapper reaches reviewed upstream only after all correction guards", () => {
  const manifestCheck = source.indexOf("candidate manifest digest drift");
  const upstreamBlobCheck = source.indexOf("upstream helper blob mismatch");
  const patchCheck = source.indexOf("server launch entry binding replacement failed");
  const syntaxCheck = source.indexOf('bash -n "$patched"');
  const patchPass = source.indexOf("PHASE128_POST136_V2_PATCH_PASS");
  const exec = source.indexOf('exec bash "$patched"');

  assert.ok(manifestCheck >= 0);
  assert.ok(upstreamBlobCheck > manifestCheck);
  assert.ok(patchCheck > upstreamBlobCheck);
  assert.ok(syntaxCheck > patchCheck);
  assert.ok(patchPass > syntaxCheck);
  assert.ok(exec > patchPass);
});

test("v2 wrapper explicitly leaves mutation and authorization untouched before exec", () => {
  for (const required of [
    "production_mutation_before_exec=NO",
    "authorization_consumed_before_exec=NO",
    "No production mutation occurs in this wrapper",
  ]) {
    assert.ok(source.includes(required), `missing v2 no-mutation proof: ${required}`);
  }

  const mutatingLines = lines.filter((line) =>
    /^sudo\s+.*\b(systemctl|install|groupadd|useradd|usermod|gpasswd|chmod|chown)\b/.test(line),
  );
  assert.deepEqual(mutatingLines, []);
});
