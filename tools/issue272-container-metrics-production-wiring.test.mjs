import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PRODUCTION_CANDIDATE_FILE_ROOTS } from "./production-candidate-manifest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(ROOT, path), "utf8");

test("issue 272 source-wires the exporter without Docker Engine authority", async () => {
  const unit = await read("ops/systemd/dashboard-rpi5-container-metrics-exporter.service");
  assert.match(unit, /User=dashboard-rpi5-container-metrics-exporter/u);
  assert.match(unit, /DynamicUser=yes/u);
  assert.match(unit, /SupplementaryGroups=dashboard-rpi5-docker-client/u);
  assert.match(unit, /DASHBOARD_DOCKER_BROKER_SOCKET=\/run\/dashboard-rpi5-docker-broker\/broker\.sock/u);
  assert.match(unit, /EnvironmentFile=\/etc\/dashboard-rpi5\/container-metrics-exporter\.env/u);
  assert.match(unit, /RestrictAddressFamilies=AF_UNIX AF_INET/u);
  assert.doesNotMatch(unit, /\/var\/run\/docker\.sock/u);
  assert.doesNotMatch(unit, /DASHBOARD_DOCKER_SOCKET_PATH/u);
  assert.doesNotMatch(unit, /(?:^|\n)(?:Group|SupplementaryGroups)=docker(?:\n|$)/u);
});

test("issue 272 fixes listener and Prometheus scrape budgets while leaving activation gated", async () => {
  const env = await read("ops/production/container-metrics-exporter.env.example");
  const scrape = await read("ops/prometheus/container-metrics-scrape.yml");
  const activation = JSON.parse(await read("ops/production/container-metrics-activation-contract.json"));
  const source = JSON.parse(await read("ops/production/container-metrics-source-contract.json"));

  assert.match(env, /DASHBOARD_CONTAINER_METRICS_LISTEN_HOST=__FRESH_PRIVATE_IPV4__/u);
  assert.match(env, /DASHBOARD_CONTAINER_METRICS_LISTEN_PORT=9464/u);
  assert.match(scrape, /job_name: dashboard-rpi5-container-metrics/u);
  assert.match(scrape, /scrape_interval: 30s/u);
  assert.match(scrape, /scrape_timeout: 20s/u);
  assert.match(scrape, /metrics_path: \/metrics/u);
  assert.match(scrape, /__DASHBOARD_CONTAINER_METRICS_PRIVATE_IPV4__:9464/u);

  assert.equal(activation.sourceWiringIssue, 272);
  assert.equal(activation.productionActivated, false);
  assert.equal(activation.service.dockerSocketAuthority, false);
  assert.equal(activation.listener.wildcardAllowed, false);
  assert.equal(activation.listener.publicAddressAllowed, false);
  assert.equal(activation.prometheus.retentionMutationAllowed, false);
  assert.ok(activation.timeoutBudgetMs.brokerSnapshot < activation.timeoutBudgetMs.brokerClient);
  assert.ok(activation.timeoutBudgetMs.brokerClient < activation.timeoutBudgetMs.exporterRequest);
  assert.ok(activation.timeoutBudgetMs.exporterRequest < activation.timeoutBudgetMs.prometheusScrapeTimeout);
  assert.ok(activation.timeoutBudgetMs.prometheusScrapeTimeout < activation.timeoutBudgetMs.prometheusScrapeInterval);
  assert.equal(activation.mutationAllowed, false);

  assert.equal(source.sourceActivationWiringIssue, 272);
  assert.equal(source.collector.activationWiringStatus, "source-ready-not-activated");
  assert.equal(source.collector.productionActivated, false);
  assert.equal(source.activationGate.sourceWiringReadyForFutureLiveEnvelope, true);
  assert.equal(source.activationGate.systemdMutationAllowedByThisContract, false);
  assert.equal(source.activationGate.prometheusScrapeMutationAllowedByThisContract, false);
  assert.equal(source.mutationAllowed, false);
});

test("issue 272 activation-critical artifacts are release-manifest inputs", () => {
  for (const path of [
    "ops/production/container-metrics-source-contract.json",
    "ops/production/container-metrics-activation-contract.json",
    "ops/production/container-metrics-exporter.env.example",
    "ops/prometheus/container-metrics-scrape.yml",
    "ops/systemd/dashboard-rpi5-container-metrics-exporter.service",
  ]) {
    assert.ok(PRODUCTION_CANDIDATE_FILE_ROOTS.includes(path), `${path} must be release-bound`);
  }
});
