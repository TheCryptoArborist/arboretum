// Fixed public reads and one checked, unsigned atomic Season 2 simulation.
// No wallet, private key, signature, execution, transfer, or live state mutation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  EXPECTED, PROOF_QUERY, PROOF_VARIABLES, INPUTS_QUERY, INPUT_VARIABLES, SIMULATION_QUERY,
  inspectState, reference, contents, NFT_PAGE_QUERY, nextNFTPageVariables, appendNFTPage,
} from './common.mjs';
import { prepareRollover, validateRolloverSimulation, validateWalletTransaction } from './rollover-core.mjs';

assert.equal(process.argv.length, 3, 'Pass a new evidence output directory.');
assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: false });
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const requests = [];
async function query(name, query, variables) {
  assert.ok([PROOF_QUERY, INPUTS_QUERY, SIMULATION_QUERY, NFT_PAGE_QUERY].includes(query));
  assert.ok(!/\bmutation\b|\bexecuteTransaction\b/.test(query));
  if (query === SIMULATION_QUERY) {
    assert.ok(!requests.some(x => x.simulation), 'Only one unsigned simulation is allowed.');
    assert.ok(query.includes('checksEnabled:true') && query.includes('doGasSelection:true'));
  }
  const requestedAt = new Date().toISOString();
  requests.push({ name, requestedAt, simulation: query === SIMULATION_QUERY });
  save(name + '-request.json', { requestedAt, endpoint: EXPECTED.endpoint, query, variables });
  const response = await fetch(EXPECTED.endpoint, {
    method: 'POST', credentials: 'omit', redirect: 'error',
    headers: { 'content-type': 'application/json', origin: EXPECTED.origin },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(45000),
  });
  const body = await response.text(); fs.writeFileSync(path.join(output, name + '-response.txt'), body, { flag: 'wx' });
  const raw = JSON.parse(body);
  const captured = { requestedAt, capturedAt: new Date().toISOString(), httpStatus: response.status, response: raw };
  save(name + '.json', captured);
  assert.equal(response.status, 200); assert.ok(raw.data && !raw.errors?.length, JSON.stringify(raw.errors));
  return captured;
}
async function inventory(name, response) {
  let raw = response, variables, pages = 0;
  while ((variables = nextNFTPageVariables(raw))) {
    assert.ok(++pages <= 100, 'NFT inventory pagination exceeds the review bound.');
    raw = appendNFTPage(raw, await query(name + '-nft-page-' + pages, NFT_PAGE_QUERY, variables));
  }
  save(name + '-complete.json', raw); return raw;
}
try {
  const proof = await query('proof', PROOF_QUERY, PROOF_VARIABLES);
  const inputs = await inventory('inputs', await query('inputs', INPUTS_QUERY, INPUT_VARIABLES));
  const before = await inspectState(inputs, proof);
  assert.equal(before.status, 'rollover-ready', 'A second season already exists or the paid first season is not ready.');
  const packet = await prepareRollover(before);
  await validateWalletTransaction(packet.transaction, packet);
  save('packet.json', { action: packet.action, adminCapReference: packet.adminCapReference,
    seasonId: packet.seasonId, durationMs: packet.durationMs,
    kindBase64: packet.kindBase64, kindSha256: packet.kindSha256, simulationTransaction: packet.simulationTransaction });
  const simulation = await inventory('simulation', await query('simulation', SIMULATION_QUERY,
    { ...INPUT_VARIABLES, transaction: packet.simulationTransaction }));
  const simulated = await validateRolloverSimulation(simulation, packet, before, proof);
  let after;
  const minimumPostTime = Math.max(Date.parse(simulation.capturedAt), Number(simulated.actualStartMs));
  for (let attempt = 1; attempt <= 10; attempt++) {
    const raw = await inventory('after-' + attempt, await query('after-' + attempt, INPUTS_QUERY, INPUT_VARIABLES));
    const candidate = await inspectState(raw, proof);
    if (candidate.checkpoint.sequenceNumber >= simulated.checkpoint.sequenceNumber &&
      Date.parse(candidate.checkpoint.timestamp) >= minimumPostTime) {
      after = candidate; save('after-selected.json', raw); break;
    }
    if (attempt < 10) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(after, 'A post-simulation chain observation has not yet been indexed.');
  assert.equal(after.status, 'rollover-ready');
  for (const name of ['registry', 'adminCap', 'upgradeCap', 'legacyRegistry', 'legacyAdminCap', 'oldSeed']) {
    assert.deepEqual(reference(before[name]), reference(after[name]));
    assert.deepEqual(contents(before[name]), contents(after[name]));
  }
  const summary = { verifiedAt: new Date().toISOString(), status: 'UNSIGNED_ATOMIC_48_HOUR_ROLLOVER_SIMULATION_VERIFIED',
    simulated, simulatedIdsAreNotDeployedIds: true,
    verifiedPreviousClaimDigest: EXPECTED.previousClaimDigest,
    actualAfter: { checkpoint: after.checkpoint, status: after.status, ...after.currentState }, requests,
    actualSignatures: 0, actualSubmissions: 0, actualSuiSpent: '0',
    sourceSha256: Object.fromEntries(['common.mjs', 'rollover-core.mjs', 'check-live.mjs'].map(name =>
      [name, createHash('sha256').update(fs.readFileSync(new URL(name, import.meta.url))).digest('hex')])) };
  save('summary.json', summary); console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  save('failure.json', { at: new Date().toISOString(), message: error.message, code: error.code, requests });
  throw error;
}
