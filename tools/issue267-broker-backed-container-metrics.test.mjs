import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(ROOT, path), "utf8");

const contract = JSON.parse(await read("ops/production/container-metrics-source-contract.json"));
const adr5 = await read("docs/adr/0005-docker-broker-only-engine-authority.md");
const adr6 = await read("docs/adr/0006-broker-backed-container-metrics-exporter.md");
const dataSources = await read("docs/DATA_SOURCES.md");
const roadmap = await read("docs/ROADMAP.md");

test("issue 267 selects a broker-backed exporter without Docker authority", () => {
  assert.equal(contract.selectionDecisionIssue, 267);
  assert.equal(contract.sourceImplementationIssue, 270);
  assert.equal(contract.collectorSelected, true);
  assert.equal(contract.collector.kind, "broker-backed-prometheus-exporter");
  assert.equal(contract.collector.implementationStatus, "source-implemented-not-activated");
  assert.equal(contract.collector.prometheusScrapeOnly, true);
  assert.equal(contract.collector.publicExposureAllowed, false);
  assert.equal(contract.collector.dockerSocketAccessAllowed, false);
  assert.equal(contract.collector.dockerSocketMountAllowed, false);
  assert.equal(contract.collector.dockerGroupMembershipAllowed, false);
  assert.equal(contract.collector.dockerTcpCredentialsAllowed, false);
  assert.equal(contract.collector.genericEngineProxyAllowed, false);
  assert.equal(contract.collector.brokerCapabilityRequired, "bounded-container-metrics-snapshot");
  assert.equal(contract.collector.brokerCapabilityImplementationAllowedBySelectionChild, false);
  assert.equal(contract.collector.brokerCapabilityImplementationIssue, 270);
  assert.equal(contract.collector.brokerCapabilityImplementedInSource, true);
  assert.equal(contract.collector.exporterImplementedInSource, true);
  assert.equal(contract.collector.productionActivated, false);
});

test("Docker broker remains the sole Engine socket authority", () => {
  assert.match(adr5, /only dashboard component permitted to own Docker Engine Unix-socket authority/u);
  assert.match(adr6, /sole Docker Engine Unix-socket authority/u);
  assert.equal(contract.dockerAuthorityBoundary.engineAuthorityOwner, "dashboard-rpi5-docker-broker");
  assert.equal(contract.dockerAuthorityBoundary.authorityExpansionAllowedByThisChild, false);
  assert.equal(
    contract.dockerAuthorityBoundary.ifAuthorityExpansionIsProposed,
    "separate-adr-security-owner-decision-required",
  );
  assert.equal(contract.exporterBrokerBoundary.fixedBrokerRoute, "/v1/docker/container-metrics/snapshot");
  assert.equal(contract.exporterBrokerBoundary.arbitraryDockerEndpointAllowed, false);
  assert.equal(contract.exporterBrokerBoundary.dockerMutationsAllowed, false);
  assert.equal(contract.exporterBrokerBoundary.timeoutBoundRequired, true);
  assert.equal(contract.exporterBrokerBoundary.responseSizeBoundRequired, true);
  assert.equal(contract.exporterBrokerBoundary.concurrencyBoundRequired, true);
  assert.equal(contract.exporterBrokerBoundary.maxConcurrentBrokerSnapshots, 1);
  assert.equal(contract.exporterBrokerBoundary.maxConcurrentExporterScrapes, 1);
  assert.equal(contract.exporterBrokerBoundary.wildcardOrPublicListenerAllowed, false);
});

test("Compose tuple is the only automatic recreate continuity identity", () => {
  assert.equal(contract.identity.primaryStrategy, "compose-project-service-container-number");
  assert.deepEqual(contract.identity.composeLabelKeys, [
    "com.docker.compose.project",
    "com.docker.compose.service",
    "com.docker.compose.container-number",
  ]);
  assert.deepEqual(contract.identity.prometheusLabelNames, [
    "compose_project",
    "compose_service",
    "compose_container_number",
  ]);
  assert.equal(contract.identity.allComposeTupleComponentsRequired, true);
  assert.equal(contract.identity.tupleComponentsMustBeValidatedAndBounded, true);
  assert.equal(contract.identity.automaticContainerNameFallbackAllowed, false);
  assert.equal(contract.identity.automaticRawContainerIdFallbackAllowed, false);
  assert.equal(contract.identity.nonComposeWithoutExplicitStaticMapping, "UNAVAILABLE");
  assert.equal(contract.identity.partialMalformedOrDuplicateTupleBehavior, "UNAVAILABLE");
  assert.equal(contract.identity.staticMappingPolicy, "server-owned-source-reviewed-bounded");
  assert.match(adr6, /same validated tuple represents the same logical history identity/u);
});

test("selection evidence is bounded provenance, not reusable runtime truth", () => {
  assert.equal(contract.selectionEvidence.notCurrentRuntimeTruth, true);
  assert.equal(contract.selectionEvidence.runningDockerContainersObserved, 20);
  assert.equal(contract.selectionEvidence.fullComposeIdentityTuplesObserved, 19);
  assert.equal(contract.selectionEvidence.uniqueFullComposeIdentityTuplesObserved, 19);
  assert.equal(contract.selectionEvidence.duplicateFullComposeIdentityTuplesObserved, 0);
  assert.equal(contract.selectionEvidence.containersWithNoSelectedComposeIdentityLabelsObserved, 1);
  assert.deepEqual(contract.selectionEvidence.selectedLabelKeysOnly, contract.identity.composeLabelKeys);
});

test("source implementation still does not authorize LIVE activation", () => {
  assert.equal(contract.mutationAllowed, false);
  assert.equal(contract.activationGate.liveAuthorizationRequired, true);
  assert.equal(contract.activationGate.collectorDeploymentAllowedByThisContract, false);
  assert.equal(contract.activationGate.brokerCapabilityRuntimeActivationAllowedByThisContract, false);
  assert.equal(contract.activationGate.prometheusScrapeMutationAllowedByThisContract, false);
  assert.equal(contract.activationGate.dockerRuntimeMutationAllowedByThisContract, false);
  assert.equal(contract.activationGate.systemdMutationAllowedByThisContract, false);
  assert.match(adr6, /source implementation is provided by #270/u);
  assert.match(dataSources, /implemented in source by #270/u);
  assert.match(roadmap, /implemented in source by #270/u);
});
