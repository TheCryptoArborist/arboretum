// Public reads and one checked unsigned simulation. Bounded read-only indexer
// catch-up never repeats the simulation. This CLI has no signer, wallet
// connection, transaction execution method or credential.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED, PROOF_QUERY, PROOF_VARIABLES, INPUTS_QUERY, INPUT_VARIABLES, SIMULATION_QUERY, sha256,
  validateInputs, buildStartRehearsal, validateSimulation, validateUnchangedAfter,
} from './start-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assert.ok(process.argv[2], 'Supply a new evidence directory');
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const save = (name, value) => fs.writeFileSync(path.join(output, name),
  typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const tracked = ['settlement-integration/season-test/start-core.mjs', 'settlement-integration/season-test/check-live.mjs',
  'settlement-integration/deployment-config.mjs', 'settlement-setup/setup-core.mjs',
  'settlement-admin/upgrade-core.mjs', 'settlement-admin/upgrade-constants.mjs', 'package-lock.json'];
const hashes = Object.fromEntries(tracked.map(name => [name, sha256(fs.readFileSync(path.join(root, name)))]));
const queries = new Set([PROOF_QUERY, INPUTS_QUERY, SIMULATION_QUERY]);
const requests = [];
async function query(name, source, variables) {
  assert.ok(queries.has(source) && /^query\s/.test(source.trim()) && !/\bmutation\b|\bexecuteTransaction\b/.test(source),
    'Only the three exact rehearsal queries are allowed');
  assert.deepEqual(Object.fromEntries(Object.entries(variables).filter(([key]) => key !== 'transaction')),
    source === PROOF_QUERY ? PROOF_VARIABLES : INPUT_VARIABLES);
  const response = await fetch(EXPECTED.endpoint, { method: 'POST', credentials: 'omit',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    signal: AbortSignal.timeout(45000), body: JSON.stringify({ query: source, variables }) });
  assert.equal(response.status, 200, 'GraphQL HTTP failure: ' + name);
  const result = await response.json();
  const capturedAt = new Date().toISOString();
  save(name + '.json', { capturedAt, endpoint: EXPECTED.endpoint, query: source, variables, response: result });
  requests.push({ name, capturedAt, checkedSimulation: source === SIMULATION_QUERY });
  assert.ok(!result.errors?.length, 'GraphQL response error: ' + JSON.stringify(result.errors));
  return result;
}

const proofRaw = await query('confirmed-proof', PROOF_QUERY, PROOF_VARIABLES);
const preflightRaw = await query('inputs', INPUTS_QUERY, INPUT_VARIABLES);
const preflight = await validateInputs(preflightRaw, proofRaw);
const packet = await buildStartRehearsal(preflight);
save('unsigned-start-kind.b64', packet.kindBase64 + '\n');
save('unsigned-packet.json', packet);
const simulationRaw = await query('simulation', SIMULATION_QUERY, { ...INPUT_VARIABLES, transaction: packet.simulationTransaction });
const simulated = await validateSimulation(simulationRaw, packet, preflight, proofRaw);
let after, selectedAfterObservation;
for (let attempt = 1; attempt <= 10; attempt += 1) {
  const name = `after-observation-${attempt}`;
  const afterRaw = await query(name, INPUTS_QUERY, INPUT_VARIABLES);
  const observed = await validateInputs(afterRaw, proofRaw);
  if (observed.checkpoint.sequenceNumber >= simulated.checkpoint.sequenceNumber &&
      Date.parse(observed.checkpoint.timestamp) >= Number(simulated.simulatedActualStartMs)) {
    after = observed;
    selectedAfterObservation = name;
    fs.copyFileSync(path.join(output, name + '.json'), path.join(output, 'after.json'), fs.constants.COPYFILE_EXCL);
    break;
  }
  if (attempt < 10) await new Promise(resolve => setTimeout(resolve, 1000));
}
assert.ok(after, 'The indexer did not reach the simulated Clock within ten read-only observations');
const actual = validateUnchangedAfter(preflight, after, simulated);
for (const [name, hash] of Object.entries(hashes)) {
  assert.equal(sha256(fs.readFileSync(path.join(root, name))), hash, 'Source changed during rehearsal: ' + name);
}
const summary = { schemaVersion: 1, verifiedAt: new Date().toISOString(),
  status: 'FIRST_SEASON_UNSIGNED_REHEARSAL_PASSED', network: 'sui:mainnet',
  proposedDurationHours: 24, durationChosenForSimulationOnly: true,
  packet: { kindSha256: packet.kindSha256, kindBytes: packet.kindBytes, commands: 1, inputs: 4 },
  simulated, actualAfterRehearsal: actual, sourceSha256: hashes, requests, selectedAfterObservation,
  actualSignaturesRequested: 0, actualTransactionsSubmitted: 0, actualGasSpentMist: '0',
  actualFundsDepositedMist: '0', actualNewObjectsCreated: 0,
  applicationOrContractChanged: false, websiteDeploymentPerformed: false,
  limits: ['This is not a signed start transaction or a confirmed season.',
    'The simulated timestamps and fees are an observation, not a future appointment or fee guarantee.',
    'The website remains read only. No user wallet or gameplay transaction was tested here.',
    'Live test inventory must be isolated from the future production economy before paid testing.'] };
save('summary.json', summary);
console.log(JSON.stringify({ status: summary.status, simulatedFeeSui: simulated.gasEstimateSui,
  checkpoint: simulated.checkpoint.sequenceNumber, actualSeasonId: actual.actualSeasonId,
  actualSeasonStartMs: actual.actualSeasonStartMs, actualGasSpentMist: '0',
  signaturesRequested: 0, transactionsSubmitted: 0, evidenceDirectory: output }, null, 2));
