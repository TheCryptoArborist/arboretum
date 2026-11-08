// Verify the current owner's Season 2 planting preview without signing or execution.
// The one simulation uses the same checked proposal as the hosted readiness button.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  EXPECTED, PROOF_QUERY, PROOF_VARIABLES, INPUTS_QUERY, INPUT_VARIABLES,
  SIMULATION_QUERY, CONFIRM_QUERY, CONFIRM_VARIABLES, inspectState,
  contents, reference, sameSnapshot,
} from './common.mjs';
import { validateConfirmedRollover } from './rollover-core.mjs';
import {
  PLANT_FIELDS_QUERY, PLANT_RECEIPT_FIELD_QUERY, plantFieldVariables, attachPlantFields, preparePlant,
  validateCareWalletTransaction, validatePlantSimulation,
} from './care-core.mjs';

assert.equal(process.argv.length, 3, 'Pass a new evidence output directory.');
assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
const output = path.resolve(process.argv[2]);
const rolloverDigest = '9SqBoBCyVA4A1mWfmBid7dGxny4ba2tzCgVPLiRS77z4';
fs.mkdirSync(output, { recursive: false });
const save = (name, value) => fs.writeFileSync(path.join(output, name + '.json'),
  JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const requests = [];
async function query(name, query, variables) {
  assert.ok([PROOF_QUERY, INPUTS_QUERY, CONFIRM_QUERY, PLANT_FIELDS_QUERY, PLANT_RECEIPT_FIELD_QUERY, SIMULATION_QUERY].includes(query));
  assert.ok(!/\bmutation\b|\bexecuteTransaction\b/.test(query));
  if (query === SIMULATION_QUERY) {
    assert.ok(!requests.some(item => item.simulation), 'Only one unsigned planting simulation is allowed.');
    assert.ok(query.includes('checksEnabled:true') && query.includes('doGasSelection:true'));
  }
  const requestedAt = new Date().toISOString();
  requests.push({ name, requestedAt, simulation: query === SIMULATION_QUERY });
  save(name + '-request', { requestedAt, endpoint: EXPECTED.endpoint, query, variables });
  const response = await fetch(EXPECTED.endpoint, {
    method: 'POST', credentials: 'omit', redirect: 'error',
    headers: { 'content-type': 'application/json', origin: EXPECTED.origin },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(45000),
  });
  const raw = await response.json();
  save(name, { requestedAt, capturedAt: new Date().toISOString(), httpStatus: response.status, response: raw });
  assert.equal(response.status, 200);
  assert.ok(raw.data && !raw.errors?.length, JSON.stringify(raw.errors));
  return raw;
}

try {
  const proof = await query('proof', PROOF_QUERY, PROOF_VARIABLES);
  const rollover = await query('rollover', CONFIRM_QUERY, { ...CONFIRM_VARIABLES, digest: rolloverDigest });
  const cycle = await validateConfirmedRollover(rollover, rolloverDigest, proof);
  const { transaction: _transaction, ...live } = rollover.data;
  const initial = await inspectState({ data: live }, proof);
  assert.equal(initial.status, 'season-two');
  assert.equal(initial.seasonSeeds.length, 0, 'The actual Seed already exists; do not prepare another planting.');
  const fields = await query('fields', PLANT_FIELDS_QUERY, plantFieldVariables(initial, EXPECTED.previousNftId));
  const before = attachPlantFields(initial, fields, EXPECTED.previousNftId);
  const packet = await preparePlant(before, EXPECTED.previousNftId, cycle);
  await validateCareWalletTransaction(packet.transaction, packet, cycle);
  save('packet', { action: packet.action, kindBase64: packet.kindBase64, kindSha256: packet.kindSha256,
    nftReference: packet.nftReference, simulationTransaction: packet.simulationTransaction, fieldInputs: packet.fieldInputs });
  const simulation = await query('simulation', SIMULATION_QUERY,
    { ...INPUT_VARIABLES, transaction: packet.simulationTransaction });
  const result = await validatePlantSimulation(simulation, packet, before, proof, cycle);
  assert.equal(result.status, 'simulated');
  assert.equal(result.action, 'plant');
  assert.equal(result.growthPoints, '10');
  assert.equal(result.priceMist, '10000000');
  assert.equal(result.rewardShareMist, '7000000');
  assert.equal(result.canWaterBeforeCutoff, true);
  const unchanged = reference(result.fieldOutputs.playerGrowth);
  assert.ok(BigInt(unchanged.version) <= BigInt(Number.MAX_SAFE_INTEGER));
  const historical = await query('historical-player-growth', PLANT_RECEIPT_FIELD_QUERY,
    { objectId: unchanged.objectId, version: Number(unchanged.version) });
  assert.deepEqual(historical.data.genesis, { sequenceNumber: 0, digest: EXPECTED.genesisDigest });
  assert.deepEqual(historical.data.playerGrowth, before.careFields.playerGrowth);
  const after = await inspectState(await query('after', INPUTS_QUERY, INPUT_VARIABLES), proof);
  sameSnapshot(after, before);
  assert.deepEqual(reference(after.nfts[0]), reference(before.nfts[0]));
  assert.equal(after.seasonSeeds.length, 0);
  const afterFields = attachPlantFields(after,
    await query('after-fields', PLANT_FIELDS_QUERY, plantFieldVariables(after, EXPECTED.previousNftId)), EXPECTED.previousNftId);
  for (const alias of Object.keys(before.careFields)) {
    assert.deepEqual(reference(afterFields.careFields[alias]), reference(before.careFields[alias]));
    assert.deepEqual(contents(afterFields.careFields[alias]), contents(before.careFields[alias]));
  }
  save('validated-preview', result);
  const summary = {
    verifiedAt: new Date().toISOString(), status: 'UNSIGNED_SEASON_TWO_PLANT_PREVIEW_VERIFIED',
    rolloverDigest, actualStartMs: cycle.actualStartMs, cutoffMs: cycle.cutoffMs,
    simulationStatus: simulation.data.simulateTransaction.effects.status,
    validated: { action: result.action, kindSha256: result.kindSha256, priceMist: result.priceMist,
      rewardShareMist: result.rewardShareMist, treasuryShareMist: result.treasuryShareMist,
      developerShareMist: result.developerShareMist, growthPoints: result.growthPoints,
      gasEstimateMist: result.gasEstimateMist, canWaterBeforeCutoff: result.canWaterBeforeCutoff },
    unchangedPlayerGrowth: unchanged, historicalPlayerGrowthReadVerified: true,
    simulatedIdsAreNotDeployedIds: true, actualAfter: { checkpoint: after.checkpoint, ...after.currentState },
    allReviewedObjectsUnchanged: true, requests, actualSignatures: 0, actualSubmissions: 0, actualSuiSpent: '0',
    sourceSha256: Object.fromEntries(['common.mjs', 'care-core.mjs', 'rollover-core.mjs', 'check-plant-live.mjs'].map(name =>
      [name, createHash('sha256').update(fs.readFileSync(new URL(name, import.meta.url))).digest('hex')])),
  };
  save('summary', summary);
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  save('failure', { at: new Date().toISOString(), name: error.name, code: error.code, message: error.message, requests });
  throw error;
}
