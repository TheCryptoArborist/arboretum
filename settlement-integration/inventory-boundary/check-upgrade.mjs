// Public reads and one checked unsigned upgrade simulation. No wallet, signer,
// credential or execution call. Bounded indexer catch-up uses public reads only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED, PROOF_QUERY, PROOF_VARIABLES, INPUTS_QUERY, INPUT_VARIABLES,
  SIMULATION_QUERY, AFTER_QUERY, validateInputs, validateCandidateBuild,
  buildBoundaryUpgrade, validateUpgradeSimulation, validateAfter, sha256,
} from './upgrade-rehearsal-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.argv.length, 4, 'Usage: node check-upgrade.mjs <passed-offline-evidence-directory> <new-output-directory>');
const offline = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
assert.notEqual(offline, output);
const read = name => JSON.parse(fs.readFileSync(path.join(offline, name), 'utf8'));
const build = read('candidate-build.json'), vm = read('summary.json');
assert.equal(vm.status, 'INVENTORY_BOUNDARY_OFFLINE_VERIFICATION_PASSED', 'Full offline tests must pass first');
assert.equal(vm.buildOnly, false); assert.equal(vm.totalFocusedTests, 67);
assert.deepEqual(vm.tests.map(item => [item.suite, item.counts]), [
  ['v2', { total: 52, passed: 52, failed: 0 }], ['v1', { total: 15, passed: 15, failed: 0 }],
]);
assert.ok(vm.tests.every(item => item.passed && item.exitCode === 0));
assert.equal(sha256(fs.readFileSync(path.join(offline, 'candidate-build.json'))), vm.candidateBuildSha256,
  'Passed tests and candidate build differ');
validateCandidateBuild(build);
const tracked = [...new Set([...Object.keys(vm.sourceSha256),
  'settlement-integration/inventory-boundary/prepare-candidate.py',
  'settlement-integration/inventory-boundary/production/candidate.json',
  'settlement-integration/inventory-boundary/production/settlement.patch',
  'settlement-integration/inventory-boundary/upgrade-rehearsal-core.mjs',
  'settlement-integration/inventory-boundary/check-upgrade.mjs',
  'settlement-integration/season-test/start-core.mjs',
  'settlement-integration/release/build-upgrade.mjs',
  'settlement-setup/setup-core.mjs', 'settlement-admin/upgrade-core.mjs',
  'settlement-admin/upgrade-constants.mjs', 'settlement-integration/deployment-config.mjs', 'package-lock.json'])];
const hashes = Object.fromEntries(tracked.map(name => [name, sha256(fs.readFileSync(path.join(root, name)))]));
for (const [name, expected] of Object.entries(vm.sourceSha256)) {
  assert.equal(hashes[name], expected, 'Source differs from the passed offline run: ' + name);
}
const offlineEvidenceSha256 = Object.fromEntries(['candidate-build.json', 'summary.json', 'v1-tests.json', 'v2-tests.json']
  .map(name => [name, sha256(fs.readFileSync(path.join(offline, name)))]));
fs.mkdirSync(output, { recursive: false });
const save = (name, value) => fs.writeFileSync(path.join(output, name),
  typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const requests = [];
let approvedSimulationTransaction, predictedPackage;
async function query(name, source, variables) {
  assert.ok(/^query\s/.test(source) && !/\bmutation\b|\bexecuteTransaction\b/.test(source), 'Only public GraphQL queries are allowed');
  if (source === PROOF_QUERY) assert.deepEqual(variables, PROOF_VARIABLES);
  else if (source === INPUTS_QUERY) assert.deepEqual(variables, INPUT_VARIABLES);
  else if (source === SIMULATION_QUERY) {
    assert.ok(approvedSimulationTransaction);
    assert.deepEqual(variables, { transaction: approvedSimulationTransaction });
    assert.ok(!requests.some(item => item.checkedSimulation), 'Simulation may be requested only once per run');
  } else if (source === AFTER_QUERY) {
    assert.ok(predictedPackage);
    assert.deepEqual(variables, { ...INPUT_VARIABLES, simulatedPackage: predictedPackage });
  } else assert.fail('Unrecognized query');
  const reply = await fetch(EXPECTED.endpoint, { method: 'POST', credentials: 'omit',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    signal: AbortSignal.timeout(45000), body: JSON.stringify({ query: source, variables }) });
  assert.equal(reply.status, 200, 'GraphQL HTTP failure: ' + name);
  const response = await reply.json(), capturedAt = new Date().toISOString();
  const capture = { capturedAt, endpoint: EXPECTED.endpoint, query: source, variables, response };
  save(name + '.json', capture);
  requests.push({ name, capturedAt, checkedSimulation: source === SIMULATION_QUERY });
  assert.ok(!response.errors?.length, 'GraphQL response error: ' + JSON.stringify(response.errors));
  return capture;
}
const proof = await query('confirmed-proof', PROOF_QUERY, PROOF_VARIABLES);
const inputs = await query('inputs', INPUTS_QUERY, INPUT_VARIABLES);
const before = await validateInputs(inputs, proof);
const packet = await buildBoundaryUpgrade(before, build, proof);
save('unsigned-upgrade.json', packet); save('upgrade-kind.b64', packet.kindBase64 + '\n');
approvedSimulationTransaction = packet.simulationTransaction;
const simulation = await query('simulation', SIMULATION_QUERY, { transaction: approvedSimulationTransaction });
const simulated = await validateUpgradeSimulation(simulation, packet, before, build, proof);
predictedPackage = simulated.simulatedPackageIdForVerificationOnly;
let actual, selectedAfterObservation;
for (let attempt = 1; attempt <= 10; attempt += 1) {
  const name = `after-observation-${attempt}`;
  const capture = await query(name, AFTER_QUERY, { ...INPUT_VARIABLES, simulatedPackage: predictedPackage });
  const after = await validateInputs(capture, proof);
  if (after.checkpoint.sequenceNumber >= simulated.checkpoint.sequenceNumber &&
      Date.parse(after.checkpoint.timestamp) >= Number(simulated.postObservationNotBeforeMs)) {
    actual = validateAfter(before, after, capture, simulated);
    selectedAfterObservation = name;
    fs.copyFileSync(path.join(output, name + '.json'), path.join(output, 'after.json'), fs.constants.COPYFILE_EXCL);
    break;
  }
  if (attempt < 10) await new Promise(resolve => setTimeout(resolve, 1000));
}
assert.ok(actual, 'Indexer did not reach the completed simulation request within ten read-only observations');
for (const [name, hash] of Object.entries(hashes)) {
  assert.equal(sha256(fs.readFileSync(path.join(root, name))), hash, 'Source changed during rehearsal: ' + name);
}
for (const [name, hash] of Object.entries(offlineEvidenceSha256)) {
  assert.equal(sha256(fs.readFileSync(path.join(offline, name))), hash, 'Passed offline evidence changed: ' + name);
}
const summary = { schemaVersion: 1, verifiedAt: new Date().toISOString(),
  status: 'INVENTORY_BOUNDARY_UNSIGNED_UPGRADE_REHEARSAL_PASSED', network: 'sui:mainnet',
  candidateInventoryVersion: 2, currentPackageVersion: 12,
  packet: { kindSha256: packet.kindSha256, kindBytes: packet.kindBytes, commands: 3, inputs: 3 },
  simulated, actualAfterRehearsal: actual, requests, selectedAfterObservation,
  sourceSha256: hashes, offlineEvidenceSha256,
  actualSignaturesRequested: 0, actualTransactionsSubmitted: 0,
  actualGasSpentMist: '0', actualFundsDepositedMist: '0',
  actualNewProductionRegistryId: null, actualNewDeploymentPackageId: null,
  applicationActivationPerformed: false, websiteDeploymentPerformed: false,
  limits: ['This is an unsigned compatibility rehearsal, not a published upgrade or approval to launch.',
    'The predicted package ID must never be used as a real deployment or application configuration.',
    'Production requires a separately verified real upgrade, fresh v2 Registry and version-aware frontend.',
    'The existing v1 Registry and old inventory remain separate test state.'] };
save('summary.json', summary);
console.log(JSON.stringify({ status: summary.status, simulatedFeeSui: simulated.gasEstimateSui,
  actualPackageVersion: actual.actualPackageVersion, actualInventoryVersion: actual.actualRegistryVersion,
  actualSeasonId: actual.actualSeasonId, actualGasSpentMist: '0',
  signaturesRequested: 0, transactionsSubmitted: 0, output }, null, 2));
