import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(ROOT, path), "utf8");

const contract = JSON.parse(await read("ops/production/container-metrics-source-contract.json"));
const phase4a = await read("docs/PHASE4A_PROMETHEUS_HISTORY.md");
const dataSources = await read("docs/DATA_SOURCES.md");
const issueDoc = await read("docs/ISSUE265_CONTAINER_METRICS_SOURCE_READINESS.md");
const adr = await read("docs/adr/0005-docker-broker-only-engine-authority.md");

test("container metrics readiness stays source-only and records evidence provenance", () => {
  assert.equal(contract.schema, "dashboard-rpi5.container-metrics-source-readiness.v1");
  assert.equal(contract.sourceOnly, true);
  assert.equal(contract.parentIssue, 247);
  assert.equal(contract.implementationIssue, 265);
  assert.equal(contract.collectorSelected, false);
  assert.equal(contract.productionBaseline.notCurrentRuntimeTruth, true);
  assert.equal(contract.productionBaseline.containerCollectorObserved, false);
  assert.equal(contract.productionBaseline.containerMetricSeriesObserved, false);
  assert.deepEqual(contract.productionBaseline.prometheusActiveJobsObserved, ["node"]);
  assert.equal(contract.mutationAllowed, false);
});

test("required per-container history capabilities are fixed and bounded", () => {
  const expected = {
    cpu: ["container_cpu_usage_seconds_total", ["cpu"]],
    memory: ["container_memory_working_set_bytes", []],
    networkReceive: ["container_network_receive_bytes_total", ["interface"]],
    networkTransmit: ["container_network_transmit_bytes_total", ["interface"]],
    filesystemRead: ["container_fs_reads_bytes_total", ["device"]],
    filesystemWrite: ["container_fs_writes_bytes_total", ["device"]],
  };

  assert.deepEqual(Object.keys(contract.requiredCapabilities), Object.keys(expected));
  for (const [key, [metric, aggregateAwayLabels]] of Object.entries(expected)) {
    assert.deepEqual(contract.requiredCapabilities[key].acceptedMetricNames, [metric], key);
    assert.deepEqual(contract.requiredCapabilities[key].aggregateAwayLabels, aggregateAwayLabels, key);
  }
  assert.equal(contract.requiredCapabilities.cpu.rateRequired, true);
  assert.equal(contract.requiredCapabilities.memory.rateRequired, false);
  assert.equal(contract.requiredCapabilities.networkReceive.rateRequired, true);
  assert.equal(contract.requiredCapabilities.networkTransmit.rateRequired, true);
  assert.equal(contract.requiredCapabilities.filesystemRead.rateRequired, true);
  assert.equal(contract.requiredCapabilities.filesystemWrite.rateRequired, true);
});

test("stable identity and cardinality requirements fail closed", () => {
  assert.equal(contract.identity.stableLogicalContainerKeyRequired, true);
  assert.equal(contract.identity.identityMustBeProvedByReadOnlyLiveEvidence, true);
  assert.equal(contract.identity.recreatedContainerContinuityMustBeDefined, true);
  assert.equal(contract.identity.rawContainerIdAsPublicHistoryKeyAllowed, false);
  assert.equal(contract.identity.labelAllowlistRequired, true);
  assert.equal(contract.identity.environmentLabelExportAllowed, false);
  assert.equal(contract.identity.unboundedContainerLabelExportAllowed, false);
  assert.equal(contract.identity.queryMustReturnOneLogicalSeriesPerContainer, true);
});

test("Docker Engine authority cannot expand through the container metrics source", () => {
  assert.match(adr, /sole production owner of Docker Engine socket access/u);
  assert.equal(contract.dockerAuthorityBoundary.engineAuthorityOwner, "dashboard-rpi5-docker-broker");
  assert.equal(contract.dockerAuthorityBoundary.collectorDockerSocketAccessAllowed, false);
  assert.equal(contract.dockerAuthorityBoundary.collectorDockerSocketMountAllowed, false);
  assert.equal(contract.dockerAuthorityBoundary.mainAgentDockerSocketAccessAllowed, false);
  assert.equal(contract.dockerAuthorityBoundary.serverDockerSocketAccessAllowed, false);
  assert.equal(contract.dockerAuthorityBoundary.authorityExpansionAllowedByThisChild, false);
  assert.equal(
    contract.dockerAuthorityBoundary.ifRequiredBySelectedCollector,
    "separate-adr-security-owner-decision-required",
  );
  assert.match(issueDoc, /unix:\/\/\/var\/run\/docker\.sock/u);
  assert.match(issueDoc, /separate ADR\/security\/owner decision/u);
});

test("Prometheus and browser boundaries remain server-owned", () => {
  assert.equal(contract.prometheusBoundary.serverOwnedQueryRegistryRequired, true);
  assert.equal(contract.prometheusBoundary.browserArbitraryPromqlAllowed, false);
  assert.equal(contract.prometheusBoundary.browserArbitraryLabelMatcherAllowed, false);
  assert.equal(contract.prometheusBoundary.browserDirectCollectorAccessAllowed, false);
  assert.equal(contract.prometheusBoundary.collectorPublicExposureAllowed, false);
  assert.equal(contract.prometheusBoundary.rawCollectorLabelsReturnedToBrowserAllowed, false);
  assert.match(phase4a, /cannot send PromQL/u);
  assert.match(issueDoc, /fixed registered expressions/u);
});

test("LIVE activation remains outside this source-only child", () => {
  assert.equal(contract.activationGate.liveAuthorizationRequired, true);
  assert.equal(contract.activationGate.collectorDeploymentAllowedByThisContract, false);
  assert.equal(contract.activationGate.prometheusScrapeMutationAllowedByThisContract, false);
  assert.equal(contract.activationGate.prometheusRetentionMutationAllowedByThisContract, false);
  assert.equal(contract.activationGate.dockerRuntimeMutationAllowedByThisContract, false);
  assert.equal(contract.activationGate.systemdMutationAllowedByThisContract, false);
  assert.equal(contract.activationGate.networkMutationAllowedByThisContract, false);
  assert.equal(contract.activationGate.requiredReadOnlyEvidence.length, 7);
  assert.match(issueDoc, /Production deploy: NO\./u);
});

test("canonical data-source docs expose the deferred container-history gate", () => {
  assert.match(phase4a, /container-metrics source-readiness gate/u);
  assert.match(dataSources, /Container history/u);
  assert.match(dataSources, /container-metrics source-readiness gate/u);
  assert.match(dataSources, /Docker broker remains the sole Docker Engine authority/u);
});
