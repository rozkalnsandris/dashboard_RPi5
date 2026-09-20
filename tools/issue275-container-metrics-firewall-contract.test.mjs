import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PRODUCTION_CANDIDATE_FILE_ROOTS } from "./production-candidate-manifest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(resolve(ROOT, path), "utf8"));

test("issue 275 binds exporter reachability without committing runtime network values", async () => {
  const firewall = await readJson("ops/production/container-metrics-firewall-contract.json");
  const activation = await readJson("ops/production/container-metrics-activation-contract.json");
  const source = await readJson("ops/production/container-metrics-source-contract.json");

  assert.equal(firewall.schema, "dashboard-rpi5.container-metrics-firewall.v1");
  assert.equal(firewall.sourceOnly, true);
  assert.equal(firewall.parentIssue, 247);
  assert.equal(firewall.sourceHardeningIssue, 275);
  assert.deepEqual(firewall.transport, { protocol: "tcp", destinationPort: 9464 });
  assert.equal(firewall.requiredRuleBinding.ingressInterfaceRequired, true);
  assert.equal(firewall.requiredRuleBinding.sourceSubnetRequired, true);
  assert.equal(firewall.requiredRuleBinding.destinationIpv4Required, true);
  assert.equal(firewall.requiredRuleBinding.protocolRequired, "tcp");
  assert.equal(firewall.requiredRuleBinding.destinationPortRequired, 9464);
  assert.match(firewall.runtimeInputs.prometheusIngressInterfacePolicy, /^fresh-/u);
  assert.match(firewall.runtimeInputs.prometheusSourceSubnetPolicy, /^fresh-/u);
  assert.match(firewall.runtimeInputs.exporterDestinationIpv4Policy, /reviewed-private-listener/u);

  for (const allowed of Object.values(firewall.forbiddenExpansion)) assert.equal(allowed, false);
  assert.equal(firewall.preflight.freshRuntimeTopologyRequired, true);
  assert.equal(firewall.preflight.existingRuleMaySatisfyOnlyIfExactBindingMatches, true);
  assert.equal(firewall.activationGate.liveMutationRequiredIfExactRuleAbsent, true);
  assert.equal(firewall.activationGate.ownerAuthorizationRequired, true);
  assert.equal(firewall.activationGate.automaticFirewallMutationAllowed, false);
  assert.equal(firewall.activationGate.mutationAllowedByThisSourceIssue, false);
  assert.equal(firewall.mutationAllowed, false);

  assert.equal(activation.firewall.contract, "ops/production/container-metrics-firewall-contract.json");
  assert.equal(activation.firewall.reachabilityRequired, true);
  assert.equal(activation.firewall.freshRuntimeTopologyRequired, true);
  assert.equal(activation.firewall.automaticMutationAllowed, false);
  assert.equal(activation.activationGate.networkMutationAllowedByThisSourceIssue, false);
  assert.equal(source.activationGate.firewallContract, "ops/production/container-metrics-firewall-contract.json");
  assert.equal(source.activationGate.exactFirewallBindingRequired, true);
  assert.equal(source.activationGate.networkMutationAllowedByThisContract, false);
});

test("issue 275 firewall contract is release-bound and contains no live network literals", async () => {
  const path = "ops/production/container-metrics-firewall-contract.json";
  const source = await readFile(resolve(ROOT, path), "utf8");
  assert.ok(PRODUCTION_CANDIDATE_FILE_ROOTS.includes(path), `${path} must be release-bound`);
  assert.doesNotMatch(source, /192\.168\.|172\.(?:1[6-9]|2\d|3[01])\./u);
  assert.doesNotMatch(source, /br-[0-9a-f]+/u);
  assert.doesNotMatch(source, /ufw\s+allow|nft\s+add\s+rule/iu);
});
