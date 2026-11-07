// Read-only release check using the same queries and validators as the browser.
// No wallet, private key, signature, execute mutation, or retry is present.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  SETUP_EXPECTED, TIP_QUERY, INPUTS_QUERY, INPUT_VARIABLES, SIMULATION_QUERY,
  CONFIRM_QUERY, CONFIRM_VARIABLES, loadReviewedSetup, validateSetupPreflight,
  validateSetupSimulation, validateConfirmedSetup, validateWalletTransaction,
} from './setup-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.argv[2];
assert.ok(destination, 'Provide a new evidence directory.');
const output = path.resolve(destination);
fs.mkdirSync(output, { recursive: false });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sourceFiles = ['settlement-setup/setup-core.mjs', 'settlement-setup/check-live.mjs',
  'settlement-admin/upgrade-core.mjs', 'settlement-admin/upgrade-constants.mjs', 'package-lock.json'];
const sourceSha256 = Object.fromEntries(sourceFiles.map(name => [name, sha256(fs.readFileSync(path.join(root, name)))]));
const write = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const postHeaders = [];
async function query(name, source, variables = {}) {
  assert.match(source.trimStart(), /^query\s/);
  const response = await fetch(SETUP_EXPECTED.graphqlEndpoint, {
    method: 'POST', credentials: 'omit', signal: AbortSignal.timeout(25000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SETUP_EXPECTED.origin },
    body: JSON.stringify({ query: source, variables }),
  });
  assert.equal(response.status, 200, 'Mainnet query failed: ' + name);
  const result = await response.json();
  write(name + '.json', { capturedAt: new Date().toISOString(), query: source, variables, response: result });
  assert.ok(!result.errors?.length, 'Mainnet query schema/error: ' + name + ': ' + JSON.stringify(result.errors));
  postHeaders.push({ query: name, allowedOrigin: response.headers.get('access-control-allow-origin') });
  return result;
}

const packet = await loadReviewedSetup(fs.readFileSync(path.join(root,
  'settlement-integration/release/evidence/20261031-empty-registry-review/setup-kind.b64'), 'utf8'));
await validateWalletTransaction(packet.transaction);
const tip = await query('tip', TIP_QUERY);
const inputs = await query('inputs', INPUTS_QUERY, { ...INPUT_VARIABLES, checkpoint: tip.data.checkpoint.sequenceNumber });
const preflight = await validateSetupPreflight(inputs, tip);
assert.equal(preflight.status, 'ready', 'An existing Registry blocks preparation of another setup.');
const rawSimulation = await query('simulation', SIMULATION_QUERY, { transaction: packet.simulationTransaction });
const simulation = await validateSetupSimulation(rawSimulation);
const receiptControl = await query('confirmation-schema-control', CONFIRM_QUERY,
  { ...CONFIRM_VARIABLES, digest: SETUP_EXPECTED.upgradeDigest });
await assert.rejects(() => validateConfirmedSetup(receiptControl, SETUP_EXPECTED.upgradeDigest),
  error => error.code === 'PACKET_MISMATCH', 'The actual upgrade receipt must never be accepted as a setup receipt.');
const cors = await fetch(SETUP_EXPECTED.graphqlEndpoint, {
  method: 'OPTIONS', credentials: 'omit', signal: AbortSignal.timeout(25000),
  headers: { Origin: SETUP_EXPECTED.origin, 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type' },
});
assert.ok(cors.ok);
const corsResult = {
  status: cors.status, allowedOrigin: cors.headers.get('access-control-allow-origin'),
  allowedMethods: cors.headers.get('access-control-allow-methods'),
  allowedHeaders: cors.headers.get('access-control-allow-headers'),
};
assert.ok([SETUP_EXPECTED.origin, '*'].includes(corsResult.allowedOrigin));
assert.match(corsResult.allowedMethods, /POST/i);
assert.ok(postHeaders.every(item => [SETUP_EXPECTED.origin, '*'].includes(item.allowedOrigin)));
for (const [name, hash] of Object.entries(sourceSha256)) {
  assert.equal(sha256(fs.readFileSync(path.join(root, name))), hash, 'Source changed during the live check: ' + name);
}
const summary = {
  schemaVersion: 1, verifiedAt: new Date().toISOString(), canonicalOrigin: SETUP_EXPECTED.origin,
  chain: SETUP_EXPECTED.chain, kindSha256: packet.kindSha256,
  preflight, simulation,
  confirmationQueryControl: { digest: SETUP_EXPECTED.upgradeDigest, status: receiptControl.data.transaction.effects.status,
    correctlyRejectedAsSetup: true, reason: 'The known upgrade is a different transaction kind.' },
  cors: corsResult, postCors: postHeaders,
  sourceSha256,
  newRegistryId: null, newAdminCapId: null,
  signaturesRequested: 0, transactionsSubmitted: 0,
  limits: ['Simulation IDs are not deployment IDs.',
    'The owner has not signed the setup through this check.',
    'The browser repeats fresh authority, inventory and simulation checks before wallet handoff.'],
};
write('summary.json', summary);
console.log(JSON.stringify({ verifiedAt: summary.verifiedAt, preflight: preflight.status,
  checkpoint: simulation.checkpoint.sequenceNumber, estimatedFeeSui: simulation.gasEstimateSui,
  existingRegistryCount: inputs.data.registries.nodes.length,
  signaturesRequested: 0, transactionsSubmitted: 0, evidenceDirectory: output }, null, 2));
